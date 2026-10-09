"""FastAPI 앱.

  GET  /api/status            엔진·장치 상태
  GET  /api/agents            요원 목록 (모델 준비 여부, 사용 엔진)
  POST /api/convert           녹음 파일(WAV/FLAC/OGG) 한 번에 변환 → WAV
  WS   /ws/stream             실시간: Float32 PCM 청크 ↔ 변환된 Float32 PCM 청크
  /                           web/dist 가 있으면 웹 UI 정적 서빙
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .agents import AgentRegistry
from .audio import decode, encode_wav
from .config import Settings, load_settings
from .engines import ConvertOptions, EngineManager
from .models import ARCHIVE_SUFFIXES, CHECKPOINT_SUFFIXES, INDEX_SUFFIXES, ModelError, install_model, remove_model
from .stream import StreamSession

log = logging.getLogger("agent_voice")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_MODEL_BYTES = 1024 * 1024 * 1024  # 모델 업로드 상한 1GB (.pth 는 보통 50~60MB, .index 는 수백 MB 까지)
MAX_CHUNK_SAMPLES = 48_000 * 5  # 스트리밍 청크 상한 5초
SAMPLE_RATES = (16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 96_000)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        registry = AgentRegistry.from_file(settings.agents_file, settings.models_dir)
        engines = EngineManager(settings.engine, settings.device, registry)
        app.state.registry = registry
        app.state.engines = engines
        app.state.settings = settings
        ready = sum(1 for a in registry.all() if a.model_ready)
        log.info("요원 %d명 로드, RVC 모델 %d개, 엔진=%s", len(registry), ready, engines.describe()["active"]["label"])
        yield

    app = FastAPI(title="요원보이스", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ----- REST ----------------------------------------------------------------------

    @app.get("/api/status")
    async def status(request: Request):
        engines: EngineManager = request.app.state.engines
        s: Settings = request.app.state.settings
        return {
            "version": __version__,
            "engine": engines.describe(),
            "modelsDir": str(s.models_dir),
            "agentsFile": str(s.agents_file),
        }

    def _agent_json(a, engines: EngineManager) -> dict:
        return {
            "id": a.id,
            "name": a.name,
            "nameEn": a.name_en,
            "role": a.role,
            "roleKo": a.role_ko,
            "color": a.color,
            "ready": a.model_ready,
            "hasIndex": bool(a.index is not None and a.index.is_file()),
            "engine": engines.engine_name(a),
            "dsp": {"pitch": a.dsp.pitch, "formant": a.dsp.formant, "fx": a.dsp.fx},
        }

    @app.get("/api/agents")
    async def list_agents(request: Request):
        registry: AgentRegistry = request.app.state.registry
        engines: EngineManager = request.app.state.engines
        engines.refresh()
        return {"engine": engines.describe(), "agents": [_agent_json(a, engines) for a in registry.all()]}

    # ----- 모델 설치/제거 --------------------------------------------------------------

    async def _save_upload(upload: UploadFile, dest: Path) -> None:
        total = 0
        with open(dest, "wb") as out:
            while True:
                block = await upload.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > MAX_MODEL_BYTES:
                    raise HTTPException(413, "모델 파일이 너무 큽니다 (최대 1GB)")
                out.write(block)
        if total == 0:
            raise HTTPException(400, f"빈 파일입니다: {upload.filename}")

    def _suffix_of(upload: UploadFile, allowed: tuple[str, ...], what: str) -> str:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in allowed:
            raise HTTPException(400, f"{what} 은(는) {', '.join(allowed)} 파일이어야 합니다: {upload.filename}")
        return suffix

    @app.post("/api/models/{agent_id}")
    async def upload_model(
        request: Request,
        agent_id: str,
        model: UploadFile = File(..., description=".pth 또는 .zip"),
        index: UploadFile | None = File(None, description=".index (선택)"),
        force: bool = Form(False),
    ):
        registry: AgentRegistry = request.app.state.registry
        engines: EngineManager = request.app.state.engines
        target = registry.get(agent_id)
        if target is None:
            raise HTTPException(404, f"알 수 없는 요원: {agent_id}")
        model_suffix = _suffix_of(model, CHECKPOINT_SUFFIXES + ARCHIVE_SUFFIXES, "모델")
        index_suffix = _suffix_of(index, INDEX_SUFFIXES, "index") if index is not None and index.filename else None
        tmp = Path(tempfile.mkdtemp(prefix="agent-voice-upload-"))
        try:
            model_path = tmp / f"upload{model_suffix}"
            await _save_upload(model, model_path)
            index_path: Path | None = None
            if index is not None and index_suffix:
                index_path = tmp / f"upload{index_suffix}"
                await _save_upload(index, index_path)
            try:
                result = await asyncio.to_thread(install_model, target, model_path, index_path, force=force)
            except ModelError as exc:
                raise HTTPException(400, str(exc)) from exc
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        engines.evict(target.id)
        engines.refresh()
        log.info("모델 설치: %s ← %s", target.id, model.filename)
        return {"agent": _agent_json(target, engines), "install": result.as_dict(), "engine": engines.describe()}

    @app.delete("/api/models/{agent_id}")
    async def delete_model(request: Request, agent_id: str):
        registry: AgentRegistry = request.app.state.registry
        engines: EngineManager = request.app.state.engines
        target = registry.get(agent_id)
        if target is None:
            raise HTTPException(404, f"알 수 없는 요원: {agent_id}")
        engines.evict(target.id)
        removed = await asyncio.to_thread(remove_model, target)
        return {"agent": _agent_json(target, engines), "removed": removed}

    @app.post("/api/convert")
    async def convert(
        request: Request,
        file: UploadFile = File(...),
        agent: str = Form(...),
        pitch: float = Form(0.0),
    ):
        registry: AgentRegistry = request.app.state.registry
        engines: EngineManager = request.app.state.engines
        target = registry.get(agent)
        if target is None:
            raise HTTPException(404, f"알 수 없는 요원: {agent}")
        data = await file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "파일이 너무 큽니다 (최대 50MB)")
        try:
            audio, sr = decode(data)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"오디오를 읽을 수 없습니다 (WAV/FLAC/OGG 만 지원): {exc}") from exc
        if audio.size == 0:
            raise HTTPException(400, "빈 오디오입니다")
        engine = engines.resolve(target)
        options = ConvertOptions(pitch=max(-24.0, min(24.0, pitch)))
        try:
            out, out_sr = await asyncio.to_thread(engine.convert, audio, sr, target, options)
        except Exception as exc:  # noqa: BLE001
            log.exception("변환 실패")
            raise HTTPException(500, f"변환 실패 ({engine.name}): {exc}") from exc
        return Response(
            content=encode_wav(out, out_sr),
            media_type="audio/wav",
            headers={
                "X-Engine": engine.name,
                "X-Agent": target.id,
                "Content-Disposition": f'inline; filename="{target.id}.wav"',
            },
        )

    # ----- WebSocket 스트리밍 ----------------------------------------------------------

    @app.websocket("/ws/stream")
    async def stream(
        ws: WebSocket,
        agent: str = Query(...),
        sr: int = Query(48_000),
        pitch: float = Query(0.0),
        gate: float = Query(-55.0),
        context: float = Query(0.25, ge=0.0, le=1.0),
        xfade: float = Query(20.0, ge=0.0, le=100.0),
    ):
        registry: AgentRegistry = ws.app.state.registry
        engines: EngineManager = ws.app.state.engines
        target = registry.get(agent)
        if target is None or sr not in SAMPLE_RATES:
            await ws.close(code=4400, reason="잘못된 요원 또는 샘플레이트")
            return
        await ws.accept()
        session = StreamSession(engines, target, sr, pitch=pitch, gate_db=gate, context_s=context, xfade_ms=xfade)
        await ws.send_text(json.dumps({**session.stats_dict(), "type": "ready"}, ensure_ascii=False))
        try:
            while True:
                message = await ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    raw = message["bytes"]
                    if len(raw) % 4 != 0:
                        await ws.send_text(json.dumps({"type": "error", "message": "Float32 PCM 이 아닙니다"}))
                        continue
                    chunk = np.frombuffer(raw, dtype=np.float32)
                    if chunk.size > MAX_CHUNK_SAMPLES:
                        await ws.send_text(json.dumps({"type": "error", "message": "청크가 너무 큽니다"}))
                        continue
                    try:
                        out = await asyncio.to_thread(session.process, chunk)
                    except Exception as exc:  # noqa: BLE001
                        log.exception("스트림 변환 실패")
                        await ws.send_text(json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False))
                        out = np.zeros_like(chunk)
                    await ws.send_bytes(out.astype(np.float32).tobytes())
                    if session.stats.chunks % 10 == 0:
                        await ws.send_text(json.dumps(session.stats_dict(), ensure_ascii=False))
                elif message.get("text") is not None:
                    await _handle_control(ws, session, registry, message["text"])
        except WebSocketDisconnect:
            pass

    # ----- 정적 웹 UI ------------------------------------------------------------------

    web_dir: Path = settings.web_dir
    if (web_dir / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=web_dir / "assets"), name="assets")
        if (web_dir / "worklet").is_dir():
            app.mount("/worklet", StaticFiles(directory=web_dir / "worklet"), name="worklet")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            candidate = (web_dir / path).resolve()
            if path and candidate.is_file() and web_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(web_dir / "index.html")

    else:

        @app.get("/", include_in_schema=False)
        async def no_web():
            return JSONResponse(
                {
                    "message": "웹 UI 가 빌드돼 있지 않습니다. voice-changer/web 에서 `npm run build` 를 실행하거나 "
                    "`npm run dev` 로 개발 서버(5173)를 띄우세요.",
                    "api": "/docs",
                }
            )

    return app


async def _handle_control(ws: WebSocket, session: StreamSession, registry: AgentRegistry, text: str) -> None:
    try:
        msg = json.loads(text)
    except json.JSONDecodeError:
        await ws.send_text(json.dumps({"type": "error", "message": "JSON 이 아닙니다"}))
        return
    kind = msg.get("type")
    if kind == "set":
        if "agent" in msg:
            target = registry.get(str(msg["agent"]))
            if target is None:
                await ws.send_text(json.dumps({"type": "error", "message": f"알 수 없는 요원: {msg['agent']}"}, ensure_ascii=False))
                return
            session.set_agent(target)
        if "pitch" in msg:
            session.set_pitch(max(-24.0, min(24.0, float(msg["pitch"]))))
        if "gate" in msg:
            session.set_gate(max(-120.0, min(0.0, float(msg["gate"]))))
        await ws.send_text(json.dumps(session.stats_dict(), ensure_ascii=False))
    elif kind == "stats":
        await ws.send_text(json.dumps(session.stats_dict(), ensure_ascii=False))
    elif kind == "ping":
        await ws.send_text(json.dumps({"type": "pong", "t": msg.get("t")}))


app = create_app()
