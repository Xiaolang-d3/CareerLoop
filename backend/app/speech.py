"""Offline dictation. Only model preparation may access the network."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import threading
from pathlib import Path
from typing import Any

import httpx

from .workspace import data_dir

MODEL_MANIFEST = json.loads(Path(__file__).with_name("speech-models.json").read_text(encoding="utf-8"))
MAX_AUDIO_SECONDS = 120
SAMPLE_RATE = 16_000
logger = logging.getLogger(__name__)

_state_lock = threading.Lock()
_inference_lock = threading.Lock()
_model: Any = None
_state = "idle"
_error = ""
_downloaded = 0
_progress = 0
_MODEL_TOTAL_BYTES = sum(spec["size"] for model in MODEL_MANIFEST.values() for spec in model["files"].values())


class SpeechBusyError(RuntimeError):
    pass


def status() -> dict[str, str | int]:
    with _state_lock:
        return {"state": _state, "error": _error, "max_seconds": 600, "progress": _progress}


def _download_progress(count: int) -> None:
    global _downloaded, _progress
    with _state_lock:
        _downloaded += count
        _progress = min(99, int(_downloaded * 100 / _MODEL_TOTAL_BYTES))


def _file_hash(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _ensure_model_files(directory: Path, *, repo: str, files: dict[str, dict]) -> None:
    # Standard HTTPS avoids the optional Hub/Xet transport, which can stall
    # behind proxies. Fixed revisions and hashes also make retries verifiable.
    directory.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(30, connect=15)) as client:
        for name, spec in files.items():
            expected_hash = spec["sha256"]
            destination = directory / name
            if destination.is_file() and _file_hash(destination) == expected_hash:
                _download_progress(destination.stat().st_size)
                continue
            partial = directory / f"{name}.part"
            if partial.is_file() and _file_hash(partial) == expected_hash:
                _download_progress(partial.stat().st_size)
                partial.replace(destination)
                continue
            try:
                url = f"https://modelscope.cn/api/v1/models/{repo}/repo?Revision={spec['revision']}&FilePath={name}"
                offset = partial.stat().st_size if partial.is_file() else 0
                headers = {"Range": f"bytes={offset}-"} if offset else {}
                with client.stream("GET", url, headers=headers) as response:
                    response.raise_for_status()
                    resumed = offset > 0 and response.status_code == 206 and response.headers.get("Content-Range", "").startswith(f"bytes {offset}-")
                    downloaded = offset if resumed else 0
                    _download_progress(downloaded)
                    with partial.open("ab" if resumed else "wb") as target:
                        for chunk in response.iter_bytes(1024 * 1024):
                            downloaded += len(chunk)
                            if downloaded > spec["size"]:
                                raise RuntimeError("Speech model download exceeds size limit")
                            target.write(chunk)
                            _download_progress(len(chunk))
                if partial.stat().st_size != spec["size"] or _file_hash(partial) != expected_hash:
                    partial.unlink(missing_ok=True)
                    raise RuntimeError("Speech model checksum mismatch")
                partial.replace(destination)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 416:
                    partial.unlink(missing_ok=True)
                raise
            # Keep a partial file on network failure. A later prepare resumes
            # it only if the fixed server revision honours the requested range.


def _load_model() -> Any:
    from .speech_engine import SpeechEngine
    root = data_dir() / "models" / "funasr-2pass"
    notice = Path(__file__).with_name("speech-models-NOTICE.txt").read_text(encoding="utf-8")
    for name, model in MODEL_MANIFEST.items():
        directory = root / name
        _ensure_model_files(directory, repo=model["repo"], files=model["files"])
        (directory / "NOTICE.txt").write_text(notice, encoding="utf-8")
    return SpeechEngine(root)


def _prepare() -> None:
    global _model, _state, _error, _progress
    try:
        model = _load_model()
    except ImportError:
        with _state_lock:
            _state = "error"
            _error = "离线语音组件尚未安装，请更新并重启灯灯。"
    except Exception:
        logger.exception("Offline speech model preparation failed")
        with _state_lock:
            _state = "error"
            _error = "语音模型准备失败。首次使用需要联网下载模型，请检查网络后重试。"
    else:
        with _state_lock:
            _model = model
            _state = "ready"
            _error = ""
            _progress = 100


def prepare() -> dict[str, str | int]:
    global _state, _error, _downloaded, _progress
    with _state_lock:
        if _state not in {"preparing", "ready"}:
            _state = "preparing"
            _error = ""
            _downloaded = _progress = 0
            threading.Thread(target=_prepare, name="speech-model-prepare", daemon=True).start()
    return status()


def _decode_audio(content: bytes, *, max_seconds: int = MAX_AUDIO_SECONDS) -> Any:
    # The capture worklet sends RIFF/WAVE only. Reject playlists and other
    # containers before invoking FFmpeg's general-purpose format detection.
    if content[:4] != b"RIFF" or content[8:12] != b"WAVE":
        raise ValueError("无法读取录音，请重新录音后重试。")
    import av
    import numpy as np

    chunks = []
    samples = 0
    try:
        with av.open(io.BytesIO(content), mode="r", format="wav") as container:
            if not container.streams.audio:
                raise ValueError("录音中没有音轨，请重新录音。")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)

            def append(frame: Any) -> None:
                nonlocal samples
                chunk = frame.to_ndarray().reshape(-1)
                samples += chunk.size
                # Encoders may pad a recording by a few milliseconds.
                if samples > max_seconds * SAMPLE_RATE:
                    raise ValueError("语音片段过长，请重新打开语音输入。")
                chunks.append(chunk)

            for frame in container.decode(audio=0):
                for converted in resampler.resample(frame):
                    append(converted)
            for converted in resampler.resample(None):
                append(converted)
    except av.error.FFmpegError as exc:
        raise ValueError("无法读取录音，请重新录音后重试。") from exc
    if not samples:
        raise ValueError("没有录到声音，请检查麦克风后重试。")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def ready_model() -> Any:
    with _state_lock:
        model = _model
    if model is None:
        raise RuntimeError("离线语音模型尚未准备好，请点击语音按钮重试。")
    return model
