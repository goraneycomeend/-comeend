"""`python -m agent_voice` 로 서버 실행."""

from __future__ import annotations

import argparse
import logging

import uvicorn

from .config import load_settings


def main() -> None:
    settings = load_settings()
    parser = argparse.ArgumentParser(prog="agent_voice", description="요원보이스 서버")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--reload", action="store_true", help="코드 변경 시 자동 재시작 (개발용)")
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run("agent_voice.main:app", host=args.host, port=args.port, reload=args.reload, log_level=args.log_level)


if __name__ == "__main__":
    main()
