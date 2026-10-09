"""모델 검사/설치: torch 없이 가짜 체크포인트를 만들어 제한된 언피클러와 설치 흐름을 검증한다."""

from __future__ import annotations

import io
import os
import pickle
import sys
import types
import zipfile
from collections import OrderedDict
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agent_voice.agents import AgentRegistry
from agent_voice.config import SERVER_DIR, Settings
from agent_voice.main import create_app
from agent_voice.models import ModelError, UnsafeCheckpoint, install_model, remove_model, scan_checkpoint

TORCH_MAGIC = 0x1950A86A20F9469CFC6C


@contextmanager
def _fake_torch():
    """pickle 이 GLOBAL 'torch._utils _rebuild_tensor_v2' / 'torch FloatStorage' 를 기록하도록 가짜 모듈을 심는다."""
    torch = types.ModuleType("torch")
    utils = types.ModuleType("torch._utils")

    class FloatStorage:  # noqa: D401
        pass

    FloatStorage.__module__ = "torch"
    FloatStorage.__qualname__ = "FloatStorage"

    def _rebuild_tensor_v2(*args):
        return None

    _rebuild_tensor_v2.__module__ = "torch._utils"
    _rebuild_tensor_v2.__qualname__ = "_rebuild_tensor_v2"
    torch.FloatStorage = FloatStorage
    utils._rebuild_tensor_v2 = _rebuild_tensor_v2
    torch._utils = utils
    saved = {k: sys.modules.get(k) for k in ("torch", "torch._utils")}
    sys.modules["torch"] = torch
    sys.modules["torch._utils"] = utils
    try:
        yield FloatStorage, _rebuild_tensor_v2
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v


class _StorageRef:
    pass


def _checkpoint_object(rebuild, *, sr="40k", version="v2", f0=1, with_weight=True):
    class _Tensor:
        def __reduce__(self):
            return (rebuild, (_StorageRef(), 0, (2, 3), (3, 1), False, OrderedDict()))

    obj = {"config": [1, 2, 3, "x"], "info": "300epoch", "sr": sr, "f0": f0, "version": version}
    if with_weight:
        obj["weight"] = OrderedDict([("enc_p.emb.weight", _Tensor()), ("dec.conv_pre.weight", _Tensor())])
    return obj


def _dump_with_pids(obj, storage_cls, fh):
    class P(pickle.Pickler):
        def persistent_id(self, o):
            if isinstance(o, _StorageRef):
                return ("storage", storage_cls, "0", "cpu", 6)
            return None

    P(fh, protocol=2).dump(obj)


def make_checkpoint(path: Path, *, legacy=False, **kw) -> Path:
    with _fake_torch() as (storage_cls, rebuild):
        obj = _checkpoint_object(rebuild, **kw)
        if legacy:
            with open(path, "wb") as fh:
                pickle.dump(TORCH_MAGIC, fh, protocol=2)
                pickle.dump(1001, fh, protocol=2)
                pickle.dump({"protocol_version": 1001, "little_endian": True, "type_sizes": {}}, fh, protocol=2)
                _dump_with_pids(obj, storage_cls, fh)
                pickle.dump(["0"], fh, protocol=2)
                fh.write(b"\x00" * 24)
        else:
            buf = io.BytesIO()
            _dump_with_pids(obj, storage_cls, buf)
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr("archive/data.pkl", buf.getvalue())
                zf.writestr("archive/data/0", b"\x00" * 24)
                zf.writestr("archive/version", "3\n")
    return path


def make_malicious(path: Path) -> Path:
    class Evil:
        def __reduce__(self):
            return (os.system, ("echo pwned",))

    payload = pickle.dumps({"weight": OrderedDict(), "config": [], "x": Evil()}, protocol=2)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("archive/data.pkl", payload)
    return path


def make_index(path: Path, size: int = 4096) -> Path:
    path.write_bytes(b"IxF2" + os.urandom(size))
    return path


# ----- scan ------------------------------------------------------------------------------


def test_scan_zip_checkpoint(tmp_path):
    r = scan_checkpoint(make_checkpoint(tmp_path / "a.pth"))
    assert r.format == "torch-zip"
    assert r.is_rvc is True
    assert r.sample_rate == "40k" and r.version == "v2" and r.f0 is True
    assert r.weights == 2
    assert r.warnings == []


def test_scan_legacy_checkpoint(tmp_path):
    r = scan_checkpoint(make_checkpoint(tmp_path / "a.pth", legacy=True, sr=48000, f0=0))
    assert r.format == "torch-legacy"
    assert r.is_rvc is True
    assert r.sample_rate == "48k" and r.f0 is False
    assert any("f0" in w for w in r.warnings)


def test_scan_rejects_malicious_pickle(tmp_path):
    with pytest.raises(UnsafeCheckpoint) as exc:
        scan_checkpoint(make_malicious(tmp_path / "evil.pth"))
    assert "system" in str(exc.value)


def test_scan_non_rvc_dict(tmp_path):
    with _fake_torch() as (storage_cls, _):
        buf = io.BytesIO()
        _dump_with_pids({"foo": 1}, storage_cls, buf)
        with zipfile.ZipFile(tmp_path / "x.pth", "w") as zf:
            zf.writestr("archive/data.pkl", buf.getvalue())
    r = scan_checkpoint(tmp_path / "x.pth")
    assert r.is_rvc is False and r.warnings


def test_scan_garbage(tmp_path):
    p = tmp_path / "junk.pth"
    p.write_bytes(b"not a checkpoint at all")
    with pytest.raises(ModelError):
        scan_checkpoint(p)


# ----- install ---------------------------------------------------------------------------


@pytest.fixture
def registry(tmp_path):
    return AgentRegistry.from_file(SERVER_DIR / "agents.json", models_dir=tmp_path / "models")


def test_install_pth_and_index(tmp_path, registry):
    jett = registry.get("jett")
    assert jett.model_ready is False
    ckpt = make_checkpoint(tmp_path / "jett_v2.pth")
    idx = make_index(tmp_path / "added_IVF.index")
    result = install_model(jett, ckpt, idx)
    assert jett.model_ready is True
    assert jett.index.is_file()
    assert result.scan.is_rvc and Path(result.model_path) == jett.model
    # 같은 요원에 index 없이 재설치하면 예전 index 는 제거된다
    install_model(jett, make_checkpoint(tmp_path / "jett_v3.pth"))
    assert jett.model_ready is True and not jett.index.is_file()
    assert remove_model(jett) == [str(jett.model)]
    assert jett.model_ready is False


def test_install_from_zip_with_junk(tmp_path, registry):
    omen = registry.get("omen")
    ckpt = make_checkpoint(tmp_path / "m.pth")
    idx = make_index(tmp_path / "m.index")
    zpath = tmp_path / "omen.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.write(ckpt, "OmenV2/omen.pth")
        zf.write(idx, "OmenV2/added_IVF256_Flat.index")
        zf.writestr("__MACOSX/OmenV2/._omen.pth", b"junk")
        zf.writestr("OmenV2/readme.txt", "hi")
    install_model(omen, zpath)
    assert omen.model_ready and omen.index.is_file()
    assert omen.model.read_bytes() == ckpt.read_bytes()


def test_install_refuses_malicious_even_with_force(tmp_path, registry):
    sage = registry.get("sage")
    with pytest.raises(UnsafeCheckpoint):
        install_model(sage, make_malicious(tmp_path / "evil.pth"), force=True)
    assert sage.model_ready is False


def test_install_refuses_non_rvc_unless_forced(tmp_path, registry):
    sage = registry.get("sage")
    with _fake_torch() as (storage_cls, _):
        buf = io.BytesIO()
        _dump_with_pids({"state_dict": OrderedDict()}, storage_cls, buf)
        with zipfile.ZipFile(tmp_path / "other.pth", "w") as zf:
            zf.writestr("archive/data.pkl", buf.getvalue())
    with pytest.raises(ModelError):
        install_model(sage, tmp_path / "other.pth")
    install_model(sage, tmp_path / "other.pth", force=True)
    assert sage.model_ready is True


def test_install_rejects_bad_inputs(tmp_path, registry):
    jett = registry.get("jett")
    with pytest.raises(ModelError):
        install_model(jett, tmp_path / "missing.pth")
    (tmp_path / "x.txt").write_text("x")
    with pytest.raises(ModelError):
        install_model(jett, tmp_path / "x.txt")
    with pytest.raises(ModelError):
        install_model(jett, make_checkpoint(tmp_path / "ok.pth"), tmp_path / "x.txt")
    empty_zip = tmp_path / "empty.zip"
    with zipfile.ZipFile(empty_zip, "w") as zf:
        zf.writestr("readme.txt", "no model here")
    with pytest.raises(ModelError):
        install_model(jett, empty_zip)


# ----- API -------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path):
    settings = Settings(engine="dsp", device="cpu", models_dir=tmp_path / "models", web_dir=tmp_path / "noweb")
    with TestClient(create_app(settings)) as c:
        yield c


def test_api_upload_and_delete(tmp_path, client):
    ckpt = make_checkpoint(tmp_path / "jett.pth")
    idx = make_index(tmp_path / "jett.index")
    with open(ckpt, "rb") as f1, open(idx, "rb") as f2:
        r = client.post(
            "/api/models/jett",
            files={"model": ("JettV2.pth", f1, "application/octet-stream"), "index": ("added.index", f2, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["agent"]["ready"] is True and body["agent"]["hasIndex"] is True
    assert body["install"]["scan"]["sample_rate"] == "40k"

    agents = client.get("/api/agents").json()["agents"]
    assert next(a for a in agents if a["id"] == "jett")["ready"] is True

    r = client.delete("/api/models/jett")
    assert r.status_code == 200 and r.json()["agent"]["ready"] is False
    assert len(r.json()["removed"]) == 2


def test_api_upload_zip(tmp_path, client):
    ckpt = make_checkpoint(tmp_path / "m.pth")
    zpath = tmp_path / "pack.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.write(ckpt, "model.pth")
    with open(zpath, "rb") as f:
        r = client.post("/api/models/omen", files={"model": ("pack.zip", f, "application/zip")})
    assert r.status_code == 200, r.text
    assert r.json()["agent"]["ready"] is True and r.json()["agent"]["hasIndex"] is False


def test_api_upload_rejections(tmp_path, client):
    evil = make_malicious(tmp_path / "evil.pth")
    with open(evil, "rb") as f:
        r = client.post("/api/models/jett", files={"model": ("evil.pth", f, "application/octet-stream")})
    assert r.status_code == 400 and "허용되지 않은" in r.json()["detail"]

    r = client.post("/api/models/jett", files={"model": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 400

    r = client.post("/api/models/jett", files={"model": ("empty.pth", b"", "application/octet-stream")})
    assert r.status_code == 400

    ckpt = make_checkpoint(tmp_path / "ok.pth")
    with open(ckpt, "rb") as f:
        r = client.post("/api/models/nobody", files={"model": ("ok.pth", f, "application/octet-stream")})
    assert r.status_code == 404
    assert client.delete("/api/models/nobody").status_code == 404
