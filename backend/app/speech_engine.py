"""Local two-pass dictation: a streaming preview and sentence-level correction."""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
SAMPLE_RATE = 16_000


class SpeechEngine:
    def __init__(self, online_directory: Path, offline_directory: Path):
        import sherpa_onnx

        self.online = sherpa_onnx.OnlineRecognizer.from_paraformer(
            encoder=str(online_directory / "encoder.int8.onnx"),
            decoder=str(online_directory / "decoder.int8.onnx"),
            tokens=str(online_directory / "tokens.txt"),
            num_threads=2, sample_rate=SAMPLE_RATE, enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.4, rule2_min_trailing_silence=0.6,
            rule3_min_utterance_length=25,
        )
        self.offline = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(offline_directory / "model.int8.onnx"),
            tokens=str(offline_directory / "tokens.txt"),
            num_threads=2, sample_rate=SAMPLE_RATE, language="zh", use_itn=True,
        )

    def transcribe(self, audio: Any) -> str:
        stream = self.offline.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        self.offline.decode_stream(stream)
        return re.sub(r"<\|[^|]*\|>", "", stream.result.text).strip()

    def create_stream(self) -> DictationStream:
        return DictationStream(self)


class DictationStream:
    def __init__(self, engine: SpeechEngine):
        self.engine = engine
        self.stream = engine.online.create_stream()
        self.frames: list[Any] = []
        self.samples = 0
        self.segment_id = 0
        self.revision = 0
        self.previous = ""

    def push(self, audio: Any) -> list[dict]:
        import numpy as np

        self.frames.append(audio)
        self.samples += len(audio)
        self.stream.accept_waveform(SAMPLE_RATE, audio)
        while self.engine.online.is_ready(self.stream):
            self.engine.online.decode_stream(self.stream)
        text = self.engine.online.get_result(self.stream).strip()
        final = self.engine.online.is_endpoint(self.stream) or self.samples >= 26 * SAMPLE_RATE
        if final and (text or self.previous):
            try:
                text = self.engine.transcribe(np.concatenate(self.frames))
            except Exception:
                # A sentence correction failure must not destroy its preview.
                logger.warning("Offline sentence correction failed; retaining streaming result")
                text = text or self.previous
        updates = []
        if text != self.previous or (final and (text or self.previous)):
            self.revision += 1
            updates.append({"segmentId": self.segment_id, "revision": self.revision,
                            "text": text, "final": final})
            self.previous = text
        if final:
            # A fresh feature extractor keeps the correction audio and preview
            # on the same boundary; reset() can retain old buffered features.
            self.stream = self.engine.online.create_stream()
            self.frames = []
            self.samples = 0
            self.segment_id += 1
            self.revision = 0
            self.previous = ""
        return updates
