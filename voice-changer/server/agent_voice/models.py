"""요원 모델 설치/검사/제거.

RVC 체크포인트(.pth) 는 torch.save 로 만든 pickle 이라 아무 코드나 실행시킬 수 있다. 커뮤니티에서 받은 파일을
그대로 torch.load 하기 전에, torch 없이도 돌아가는 **제한된 언피클러**로 내용을 읽어

  * 허용 목록(텐서 재구성, OrderedDict, numpy 스칼라 등) 밖의 객체가 들어 있으면 거부하고
  * RVC 체크포인트 구조(weight/config/sr/f0/version) 인지 확인하며
  * 샘플레이트·버전 같은 메타데이터를 꺼내 준다.

사용:
  python -m agent_voice.models scan   model.pth
  python -m agent_voice.models install jett model.pth [--index model.index]
  python -m agent_voice.models install jett jett.zip                 # zip 안의 .pth/.index 를 찾아 설치
  python -m agent_voice.models install jett https://.../jett.zip      # URL 도 가능
  python -m agent_voice.models remove  jett
  python -m agent_voice.models list
"""

from __future__ import annotations

import argparse
import io
import json
import pickle
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import BinaryIO

from .agents import Agent, AgentRegistry
from .config import load_settings

MAX_PICKLE_BYTES = 64 * 1024 * 1024  # data.pkl 상한 (가중치 자체는 별도 파일이라 pickle 은 보통 수 MB)
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
CHECKPOINT_SUFFIXES = (".pth", ".pt")
INDEX_SUFFIXES = (".index",)
ARCHIVE_SUFFIXES = (".zip",)


class ModelError(Exception):
    """설치할 수 없는 모델 (형식 오류, 안전하지 않음 등)."""


class UnsafeCheckpoint(ModelError):
    """허용되지 않은 객체가 들어 있는 pickle."""


# ----- 제한된 언피클러 -------------------------------------------------------------------


class _Opaque:
    """허용된 객체의 자리표시자. 아무 동작도 하지 않는다."""

    __slots__ = ("shape",)

    def __init__(self, shape: tuple | None = None):
        self.shape = shape

    def __setstate__(self, state):  # BUILD 옵코드 대응
        return None

    def __call__(self, *args, **kwargs):  # 중첩 REDUCE 대응 (예: _rebuild_from_type_v2)
        return _Opaque()


def _rebuild_tensor(storage=None, storage_offset=0, size=(), *rest):
    try:
        return _Opaque(tuple(int(s) for s in size))
    except Exception:  # noqa: BLE001
        return _Opaque()


def _opaque(*args, **kwargs):
    return _Opaque()


_STORAGE_TYPES = (
    "FloatStorage", "HalfStorage", "BFloat16Storage", "DoubleStorage", "LongStorage", "IntStorage",
    "ShortStorage", "CharStorage", "ByteStorage", "BoolStorage", "UntypedStorage",
)

ALLOWED_GLOBALS: dict[tuple[str, str], object] = {
    ("collections", "OrderedDict"): OrderedDict,
    ("torch._utils", "_rebuild_tensor_v2"): _rebuild_tensor,
    ("torch._utils", "_rebuild_tensor"): _rebuild_tensor,
    ("torch._utils", "_rebuild_parameter"): _opaque,
    ("torch._utils", "_rebuild_parameter_with_state"): _opaque,
    ("torch._tensor", "_rebuild_from_type_v2"): _opaque,
    ("torch", "device"): _opaque,
    ("torch", "Size"): tuple,
    ("torch.storage", "_load_from_bytes"): _opaque,
    ("_codecs", "encode"): _opaque,
    ("numpy", "dtype"): _opaque,
    ("numpy", "ndarray"): _Opaque,
    ("numpy.core.multiarray", "scalar"): _opaque,
    ("numpy.core.multiarray", "_reconstruct"): _opaque,
    ("numpy._core.multiarray", "scalar"): _opaque,
    ("numpy._core.multiarray", "_reconstruct"): _opaque,
}
for _name in _STORAGE_TYPES:
    ALLOWED_GLOBALS[("torch", _name)] = _Opaque
    ALLOWED_GLOBALS[("torch.storage", _name)] = _Opaque


class RestrictedUnpickler(pickle.Unpickler):
    """허용 목록에 없는 전역 객체를 만나면 즉시 실패하는 언피클러. 텐서는 모양만 남긴 자리표시자로 바꾼다."""

    def find_class(self, module: str, name: str):
        obj = ALLOWED_GLOBALS.get((module, name))
        if obj is None:
            raise UnsafeCheckpoint(f"허용되지 않은 객체가 들어 있습니다: {module}.{name}")
        return obj

    def persistent_load(self, pid):
        return _Opaque()


def _restricted_load(stream: BinaryIO):
    return RestrictedUnpickler(stream).load()


# ----- 검사 ------------------------------------------------------------------------------


@dataclass
class ScanResult:
    path: str
    format: str  # "torch-zip" | "torch-legacy"
    is_rvc: bool
    sample_rate: str | None = None
    version: str | None = None
    f0: bool | None = None
    info: str | None = None
    weights: int = 0
    size_bytes: int = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def _load_checkpoint_object(path: Path) -> tuple[object, str]:
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if n.endswith("/data.pkl") or n == "data.pkl"]
            if not names:
                raise ModelError("torch 체크포인트 형식이 아닙니다 (data.pkl 없음)")
            info = zf.getinfo(names[0])
            if info.file_size > MAX_PICKLE_BYTES:
                raise ModelError("체크포인트 메타데이터(data.pkl) 가 비정상적으로 큽니다")
            data = zf.read(names[0])
        return _restricted_load(io.BytesIO(data)), "torch-zip"

    # torch 1.6 이전 레거시 형식: magic, protocol, sys_info, 본체 순으로 pickle 이 이어진다
    size = path.stat().st_size
    with open(path, "rb") as fh:
        head = fh.read(min(size, MAX_PICKLE_BYTES))
    stream = io.BytesIO(head)
    try:
        magic = _restricted_load(stream)
        if magic != 0x1950A86A20F9469CFC6C:
            raise ModelError("torch 체크포인트 형식이 아닙니다 (magic 불일치)")
        _restricted_load(stream)  # protocol version
        _restricted_load(stream)  # sys_info
        obj = _restricted_load(stream)
    except UnsafeCheckpoint:
        raise
    except (pickle.UnpicklingError, EOFError, ValueError, TypeError, AttributeError, IndexError) as exc:
        raise ModelError(f"체크포인트를 읽을 수 없습니다: {exc}") from exc
    return obj, "torch-legacy"


def scan_checkpoint(path: Path) -> ScanResult:
    """.pth 를 torch 없이 안전하게 읽어 구조와 메타데이터를 확인한다. 위험하면 UnsafeCheckpoint."""
    path = Path(path)
    if not path.is_file():
        raise ModelError(f"파일이 없습니다: {path}")
    try:
        obj, fmt = _load_checkpoint_object(path)
    except UnsafeCheckpoint:
        raise
    except ModelError:
        raise
    except Exception as exc:  # noqa: BLE001 - pickle 내부의 온갖 예외
        raise ModelError(f"체크포인트를 읽을 수 없습니다: {exc}") from exc

    result = ScanResult(path=str(path), format=fmt, is_rvc=False, size_bytes=path.stat().st_size)
    if not isinstance(obj, dict):
        result.warnings.append("최상위가 dict 가 아니라 RVC 체크포인트로 보이지 않습니다")
        return result
    weight = obj.get("weight")
    if isinstance(weight, dict):
        result.weights = len(weight)
    config = obj.get("config")
    result.is_rvc = isinstance(weight, dict) and len(weight) > 0 and isinstance(config, (list, tuple))
    sr = obj.get("sr")
    if sr is not None:
        result.sample_rate = f"{int(sr) // 1000}k" if isinstance(sr, int) else str(sr)
    version = obj.get("version")
    result.version = str(version) if version is not None else None
    f0 = obj.get("f0")
    result.f0 = bool(f0) if f0 is not None else None
    info = obj.get("info")
    result.info = str(info)[:200] if info is not None else None
    if not result.is_rvc:
        result.warnings.append("weight/config 키가 없어 RVC 체크포인트 형식이 아닙니다")
    if result.version not in (None, "v1", "v2"):
        result.warnings.append(f"알 수 없는 RVC 버전: {result.version}")
    if result.f0 is False:
        result.warnings.append("f0 없는 모델입니다 (피치 조절이 적용되지 않음)")
    return result


# ----- 설치 ------------------------------------------------------------------------------


@dataclass
class InstallResult:
    agent: str
    model_path: str
    index_path: str | None
    scan: ScanResult

    def as_dict(self) -> dict:
        return {"agent": self.agent, "modelPath": self.model_path, "indexPath": self.index_path, "scan": self.scan.as_dict()}


def _kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in CHECKPOINT_SUFFIXES:
        return "checkpoint"
    if suffix in INDEX_SUFFIXES:
        return "index"
    if suffix in ARCHIVE_SUFFIXES:
        return "archive"
    raise ModelError(f"지원하지 않는 파일 형식입니다: {path.name} (.pth / .index / .zip)")


def _extract_archive(archive: Path, workdir: Path) -> tuple[Path | None, Path | None]:
    """zip 안에서 첫 .pth 와 첫 .index 를 꺼낸다. 멤버 경로는 쓰지 않아 zip-slip 이 불가능하다."""
    if not zipfile.is_zipfile(archive):
        raise ModelError("zip 파일이 아닙니다")
    found_ckpt: Path | None = None
    found_index: Path | None = None
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            if member.is_dir():
                continue
            name = Path(member.filename).name
            lower = name.lower()
            if lower.startswith("._") or "__macosx" in member.filename.lower():
                continue
            if found_ckpt is None and lower.endswith(CHECKPOINT_SUFFIXES):
                found_ckpt = workdir / "model.pth"
                with zf.open(member) as src, open(found_ckpt, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            elif found_index is None and lower.endswith(INDEX_SUFFIXES):
                found_index = workdir / "model.index"
                with zf.open(member) as src, open(found_index, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            if found_ckpt is not None and found_index is not None:
                break
    if found_ckpt is None:
        raise ModelError("zip 안에 .pth 파일이 없습니다")
    return found_ckpt, found_index


def _validate_index(path: Path) -> None:
    if path.stat().st_size < 64:
        raise ModelError(".index 파일이 비어 있거나 너무 작습니다")


def install_model(agent: Agent, source: Path, index: Path | None = None, *, force: bool = False) -> InstallResult:
    """source(.pth 또는 .zip) 와 선택적 index 를 검사해 agent 의 모델 경로로 복사한다.

    force=True 면 RVC 형식 경고가 있어도 설치한다. 안전하지 않은 pickle 은 force 와 무관하게 거부한다.
    """
    if agent.model is None:
        raise ModelError(f"{agent.name} 은 agents.json 에 model 경로가 없습니다")
    source = Path(source)
    if not source.is_file():
        raise ModelError(f"파일이 없습니다: {source}")
    workdir = Path(tempfile.mkdtemp(prefix="agent-voice-install-"))
    try:
        kind = _kind(source)
        if kind == "index":
            raise ModelError("첫 번째 인자는 .pth 또는 .zip 이어야 합니다 (.index 는 --index 로)")
        ckpt: Path
        if kind == "archive":
            ckpt, found_index = _extract_archive(source, workdir)
            if index is None:
                index = found_index
        else:
            ckpt = source
        if index is not None:
            index = Path(index)
            if not index.is_file():
                raise ModelError(f"index 파일이 없습니다: {index}")
            if _kind(index) != "index":
                raise ModelError("index 는 .index 파일이어야 합니다")
            _validate_index(index)

        scan = scan_checkpoint(ckpt)
        if not scan.is_rvc and not force:
            raise ModelError("RVC 체크포인트로 보이지 않습니다: " + "; ".join(scan.warnings) + " (그래도 설치하려면 force)")

        agent.model.parent.mkdir(parents=True, exist_ok=True)
        _atomic_copy(ckpt, agent.model)
        index_target: Path | None = None
        if index is not None:
            index_target = agent.index if agent.index is not None else agent.model.with_suffix(".index")
            index_target.parent.mkdir(parents=True, exist_ok=True)
            _atomic_copy(index, index_target)
        elif agent.index is not None and agent.index.is_file():
            # 새 모델에 index 가 없으면 예전 index 는 맞지 않으므로 치운다
            agent.index.unlink()
        scan.path = str(agent.model)
        return InstallResult(agent=agent.id, model_path=str(agent.model), index_path=str(index_target) if index_target else None, scan=scan)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def remove_model(agent: Agent) -> list[str]:
    removed: list[str] = []
    for p in (agent.model, agent.index):
        if p is not None and p.is_file():
            p.unlink()
            removed.append(str(p))
    return removed


def _atomic_copy(src: Path, dst: Path) -> None:
    tmp = dst.with_name(dst.name + ".part")
    shutil.copyfile(src, tmp)
    tmp.replace(dst)


def download(url: str, dest_dir: Path) -> Path:
    """http(s) URL 을 dest_dir 에 내려받는다 (CLI 전용)."""
    if not url.lower().startswith(("http://", "https://")):
        raise ModelError("http(s) URL 만 지원합니다")
    name = Path(urllib.parse.urlparse(url).path).name or "model.bin"
    if not name.lower().endswith(CHECKPOINT_SUFFIXES + INDEX_SUFFIXES + ARCHIVE_SUFFIXES):
        name = name + ".zip"
    target = dest_dir / name
    req = urllib.request.Request(url, headers={"User-Agent": "agent-voice/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(target, "wb") as out:  # noqa: S310 - 사용자가 준 URL
        total = 0
        while True:
            block = resp.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > MAX_DOWNLOAD_BYTES:
                raise ModelError("다운로드 크기가 2GB 를 넘습니다")
            out.write(block)
            sys.stderr.write(f"\r다운로드 중… {total / 1024 / 1024:.1f} MB")
        sys.stderr.write("\n")
    return target


# ----- CLI -------------------------------------------------------------------------------


def _print(obj: object) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    settings = load_settings()
    parser = argparse.ArgumentParser(prog="python -m agent_voice.models", description="요원 모델 설치/검사/제거")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_scan = sub.add_parser("scan", help=".pth 가 안전한 RVC 체크포인트인지 검사")
    p_scan.add_argument("path")

    p_install = sub.add_parser("install", help="요원에 모델 설치")
    p_install.add_argument("agent", help="요원 id (예: jett)")
    p_install.add_argument("source", help=".pth / .zip 경로 또는 URL")
    p_install.add_argument("--index", help=".index 경로 또는 URL (zip 에 들어 있으면 생략)")
    p_install.add_argument("--force", action="store_true", help="RVC 형식 경고가 있어도 설치")

    p_remove = sub.add_parser("remove", help="요원 모델 삭제")
    p_remove.add_argument("agent")

    sub.add_parser("list", help="요원별 모델 상태")

    args = parser.parse_args(argv)
    registry = AgentRegistry.from_file(settings.agents_file, settings.models_dir)

    try:
        if args.cmd == "scan":
            _print(scan_checkpoint(Path(args.path)).as_dict())
            return 0
        if args.cmd == "list":
            rows = []
            for a in registry.all():
                rows.append({"id": a.id, "name": a.name, "ready": a.model_ready, "model": str(a.model), "index": bool(a.index and a.index.is_file())})
            _print(rows)
            return 0
        agent = registry.get(args.agent)
        if agent is None:
            print(f"알 수 없는 요원: {args.agent} (가능: {', '.join(a.id for a in registry.all())})", file=sys.stderr)
            return 2
        if args.cmd == "remove":
            removed = remove_model(agent)
            print("삭제: " + (", ".join(removed) if removed else "(모델 없음)"))
            return 0
        if args.cmd == "install":
            tmp = Path(tempfile.mkdtemp(prefix="agent-voice-dl-"))
            try:
                source = download(args.source, tmp) if "://" in args.source else Path(args.source)
                index = None
                if args.index:
                    index = download(args.index, tmp) if "://" in args.index else Path(args.index)
                result = install_model(agent, source, index, force=args.force)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            _print(result.as_dict())
            print(f"\n{agent.name} 모델 설치 완료. 서버가 떠 있으면 /api/agents 에서 바로 ready=true 로 보입니다.")
            return 0
    except ModelError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
