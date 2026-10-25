"""FunASR ONNX two-pass dictation with per-session VAD and streaming caches."""
from __future__ import annotations

import copy
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
SAMPLE_RATE = 16_000
ONLINE_CHUNK = 9600  # Official [5, 10, 5] Paraformer chunks: 600 ms.
MAX_SENTENCE = 25 * SAMPLE_RATE
PRE_ROLL = SAMPLE_RATE
DEFAULT_HOTWORDS = ("灯灯", "语音转写", "工作区")


def _text(result: Any) -> str:
    if not result:
        return ""
    pred = result[0].get("preds", "")
    return str(pred[0] if isinstance(pred, (tuple, list)) else pred).strip()


class SpeechEngine:
    def __init__(self, directory: Path):
        from ._vendor.funasr_onnx import CT_Transformer, ContextualParaformer, Fsmn_vad_online, OnlineParaformer
        from ._vendor.funasr_onnx.utils.utils import read_yaml

        import onnxruntime
        onnxruntime.disable_telemetry_events()
        options = {"quantize": True, "intra_op_num_threads": 2}
        self.online = OnlineParaformer(str(directory / "online"), **options)
        self.offline = ContextualParaformer(str(directory / "offline"), **options)
        self.vad = Fsmn_vad_online(str(directory / "vad"), max_end_sil=800, **options)
        self.punctuation = CT_Transformer(str(directory / "punc"), **options)
        self.online_cmvn = str(directory / "online/am.mvn")
        self.online_frontend = read_yaml(directory / "online/config.yaml")["frontend_conf"]

    def new_online(self) -> Any:
        from ._vendor.funasr_onnx.utils.frontend import WavFrontendOnline

        # Weights are shared; the feature extractor and decoder cache are not.
        model = copy.copy(self.online)
        model.frontend = WavFrontendOnline(cmvn_file=self.online_cmvn, **self.online_frontend)
        return model

    def transcribe(self, audio: Any, hotwords: tuple[str, ...] = DEFAULT_HOTWORDS) -> str:
        text = _text(self.offline(audio, hotwords=" ".join(hotwords)))
        if not text:
            return ""
        try:
            result = self.punctuation(text)
            return result[0] if result and result[0] else text
        except Exception:
            logger.warning("Sentence punctuation failed; retaining recognition result")
            return text

    def create_stream(self, hotwords: tuple[str, ...] = DEFAULT_HOTWORDS) -> DictationStream:
        return DictationStream(self, hotwords)


class DictationStream:
    def __init__(self, engine: SpeechEngine, hotwords: tuple[str, ...] = DEFAULT_HOTWORDS):
        import numpy as np

        self.engine = engine
        self.hotwords = hotwords
        self.vad_cache: dict = {"in_cache": [], "is_final": False}
        self.audio = np.empty(0, dtype=np.float32)
        self.offset = 0
        self.received = 0
        self.start: int | None = None
        self.segment_id = 0
        self.revision = 0
        self.previous = ""
        self._reset_online()

    def _reset_online(self) -> None:
        self.online = self.engine.new_online()
        self.online_cache: dict = {"cache": {}, "is_final": False}
        self.online_cursor = 0
        self.preview = ""

    def _slice(self, start: int, end: int) -> Any:
        return self.audio[max(0, start - self.offset):max(0, end - self.offset)]

    def _append_preview(self, piece: str) -> None:
        if re.search(r"[A-Za-z0-9]$", self.preview) and re.match(r"^[A-Za-z0-9]", piece):
            self.preview += " "
        self.preview += piece

    def _decode_to(self, end: int, *, final: bool = False) -> None:
        while self.online_cursor + ONLINE_CHUNK <= end:
            audio = self._slice(self.online_cursor, self.online_cursor + ONLINE_CHUNK)
            self._append_preview(_text(self.online(audio, param_dict=self.online_cache)))
            self.online_cursor += ONLINE_CHUNK
        if final:
            self.online_cache["is_final"] = True
            self._append_preview(_text(self.online(self._slice(self.online_cursor, end), param_dict=self.online_cache)))
            self.online_cursor = end

    def _update(self, text: str, *, final: bool) -> list[dict]:
        if text == self.previous and not final:
            return []
        if not text and not self.previous:
            return []
        self.revision += 1
        self.previous = text
        return [{"segmentId": self.segment_id, "revision": self.revision, "text": text, "final": final}]

    def _finish(self, end: int) -> list[dict]:
        try:
            self._decode_to(end, final=True)
        except Exception:
            logger.warning("Streaming finalization failed; using sentence recognition")
        try:
            text = self.engine.transcribe(self._slice(self.start, end), self.hotwords) or self.preview or self.previous
        except Exception:
            logger.warning("Sentence recognition failed; retaining streaming result")
            text = self.preview or self.previous
        updates = self._update(text, final=True)
        self.start = None
        self.segment_id += 1
        self.revision = 0
        self.previous = ""
        self._reset_online()
        return updates

    def push(self, audio: Any) -> list[dict]:
        import numpy as np

        self.audio = np.concatenate((self.audio, audio))
        self.received += len(audio)
        segments = self.engine.vad(audio, param_dict=self.vad_cache)
        updates = []
        # The wrapper returns one list of [start_ms, end_ms] pairs per batch.
        for batch in segments:
            for start_ms, end_ms in batch:
                if start_ms >= 0 and self.start is None:
                    self.start = max(self.offset, int(start_ms * SAMPLE_RATE / 1000))
                    self.online_cursor = self.start
                if end_ms >= 0 and self.start is not None:
                    end = min(self.received, int(end_ms * SAMPLE_RATE / 1000))
                    if end > self.start:
                        updates.extend(self._finish(end))
        if self.start is not None:
            while self.received - self.start >= MAX_SENTENCE:
                boundary = self.start + MAX_SENTENCE
                updates.extend(self._finish(boundary))
                # VAD may remain inside the same long utterance.
                self.start = boundary
                self.online_cursor = boundary
            self._decode_to(self.received)
            updates.extend(self._update(self.preview, final=False))
        retain = self.start if self.start is not None else max(0, self.received - PRE_ROLL)
        remove = max(0, retain - self.offset)
        self.audio = self.audio[remove:].copy()
        self.offset += remove
        return updates
