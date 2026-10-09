import io
import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from agent_voice.agents import AgentRegistry
from agent_voice.config import SERVER_DIR, Settings
from agent_voice.main import create_app

SR = 48_000


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    models = tmp_path_factory.mktemp("models")
    settings = Settings(engine="dsp", device="cpu", models_dir=models, web_dir=tmp_path_factory.mktemp("noweb"))
    with TestClient(create_app(settings)) as c:
        yield c


def _wav_bytes(freq=200.0, seconds=0.8, sr=SR) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    x = (0.4 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, x, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def test_agents_json_is_valid():
    reg = AgentRegistry.from_file(SERVER_DIR / "agents.json")
    agents = reg.all()
    assert len(agents) >= 20
    assert {a.role for a in agents} == {"duelist", "initiator", "controller", "sentinel"}
    assert reg.get("jett") is not None and reg.get("jett").name == "제트"


def test_status_and_agents(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["engine"]["active"]["name"] == "dsp"

    r = client.get("/api/agents")
    assert r.status_code == 200
    body = r.json()
    assert body["engine"]["mode"] == "dsp"
    ids = [a["id"] for a in body["agents"]]
    assert "jett" in ids and "omen" in ids
    jett = next(a for a in body["agents"] if a["id"] == "jett")
    assert jett["ready"] is False  # 모델 없음
    assert jett["engine"] == "dsp"
    assert jett["roleKo"] == "타격대"


def test_convert_roundtrip(client):
    r = client.post(
        "/api/convert",
        files={"file": ("in.wav", _wav_bytes(), "audio/wav")},
        data={"agent": "jett", "pitch": "0"},
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("audio/wav")
    assert r.headers["x-engine"] == "dsp"
    y, sr = sf.read(io.BytesIO(r.content), dtype="float32")
    assert sr == SR
    assert abs(len(y) - int(0.8 * SR)) < 10
    assert np.max(np.abs(y)) > 0.05


def test_convert_unknown_agent_and_bad_file(client):
    r = client.post("/api/convert", files={"file": ("in.wav", _wav_bytes(), "audio/wav")}, data={"agent": "nope"})
    assert r.status_code == 404
    r = client.post("/api/convert", files={"file": ("in.txt", b"hello", "text/plain")}, data={"agent": "jett"})
    assert r.status_code == 400


def test_stream_roundtrip(client):
    chunk_len = int(0.4 * SR)
    t = np.arange(chunk_len) / SR
    loud = (0.4 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    quiet = np.zeros(chunk_len, np.float32)

    with client.websocket_connect("/ws/stream?agent=omen&sr=48000&gate=-55") as ws:
        ready = json.loads(ws.receive_text())
        assert ready["type"] == "ready" and ready["agent"] == "omen" and ready["engine"] == "dsp"

        for _ in range(3):
            ws.send_bytes(loud.tobytes())
            out = np.frombuffer(ws.receive_bytes(), dtype=np.float32)
            assert out.shape == (chunk_len,)
            assert np.all(np.isfinite(out))
        assert np.max(np.abs(out)) > 0.05

        # 조용한 청크는 게이트에 걸려 무음이 나온다
        ws.send_bytes(quiet.tobytes())
        out = np.frombuffer(ws.receive_bytes(), dtype=np.float32)
        assert out.shape == (chunk_len,)
        # 보류 구간(xfade) 이외에는 0
        assert np.max(np.abs(out[2000:])) == 0

        # 요원·피치 변경
        ws.send_text(json.dumps({"type": "set", "agent": "jett", "pitch": 2}))
        stats = json.loads(ws.receive_text())
        assert stats["type"] == "stats" and stats["agent"] == "jett"

        ws.send_text(json.dumps({"type": "set", "agent": "unknown"}))
        err = json.loads(ws.receive_text())
        assert err["type"] == "error"

        ws.send_text(json.dumps({"type": "ping", "t": 123}))
        assert json.loads(ws.receive_text()) == {"type": "pong", "t": 123}


def test_stream_rejects_bad_params(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/stream?agent=nope&sr=48000") as ws:
            ws.receive_text()


def test_models_dir_remap(tmp_path: Path):
    (tmp_path / "jett.pth").write_bytes(b"x")
    reg = AgentRegistry.from_file(SERVER_DIR / "agents.json", models_dir=tmp_path)
    assert reg.get("jett").model == tmp_path / "jett.pth"
    assert reg.get("jett").model_ready is True
    assert reg.get("omen").model_ready is False
