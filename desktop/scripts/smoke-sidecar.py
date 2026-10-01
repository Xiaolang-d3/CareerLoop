"""Exercise a packaged runtime with synthetic data, then verify it exits."""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", type=Path, default=ROOT / "desktop/src-tauri/resources/careerloop-runtime/careerloop-runtime")
    args = parser.parse_args()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    instance_id = str(uuid.uuid4())
    version = json.loads((ROOT / "desktop/src-tauri/tauri.conf.json").read_text())["version"]
    opener = build_opener(ProxyHandler({}))

    def request(path: str, payload=None, token: str = ""):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = json.dumps(payload).encode() if payload is not None else None
        with opener.open(Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers), timeout=2) as response:
            return json.load(response)

    with tempfile.TemporaryDirectory(prefix="careerloop-sidecar-smoke-") as directory:
        with (Path(directory) / "runtime.log").open("w+") as log:
            process = subprocess.Popen(
                [str(args.executable.resolve()), "--data-dir", directory, "--port", str(port), "--instance-id", instance_id],
                cwd=directory, stdout=log, stderr=log,
                env={**os.environ, "EMBEDDING_BACKEND": "hash", "ATTACHMENT_STORAGE": "local", "OPENAI_API_KEY": "", "MODEL_PROTOCOL": "openai", "WEB_RESEARCH_ENABLED": "false"},
            )
            try:
                deadline = time.monotonic() + 20
                while True:
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(f"Runtime exited during startup:\n{log.read()}")
                    try:
                        health = request("/health")
                        break
                    except (URLError, TimeoutError):
                        if time.monotonic() >= deadline:
                            raise RuntimeError("Runtime startup timed out")
                        time.sleep(0.1)
                assert health == {"status": "ok", "service": "careerloop", "version": version, "instance_id": instance_id}, health
                account = request("/auth/register", {"email": "smoke@local.test", "password": "synthetic-smoke-password"})
                token = account["access_token"]
                assert request("/library", token=token)["sources"] == []
                request("/library/sources", {"title": "Smoke note", "content": "本地资料无需模型配置即可保存。"}, token)
                assert len(request("/library", token=token)["sources"]) == 1
                assert request("/agent/capabilities", token=token)["configured"] is False
                print("Packaged runtime: health identity, registration, SQLite/library and missing-model mode passed.")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                    raise RuntimeError("Runtime did not exit on termination")
            with socket.socket() as probe:
                probe.settimeout(1)
                assert probe.connect_ex(("127.0.0.1", port)) != 0, "Runtime port is still open"
            print("Packaged runtime: process exit and loopback port release passed.")


if __name__ == "__main__":
    main()
