# FunASR ONNX runtime source

Source: official `funasr-onnx==0.4.3` PyPI wheel, maintained by Alibaba's
Speech Lab / ModelScope FunASR (MIT; see LICENSE).
Wheel SHA256: `7dd65d6a506dc171a53e87eb55faf0a3e478f2531f90671246f43c2c56023fe6`.
Upstream: https://github.com/modelscope/FunASR/tree/main/runtime/python/onnxruntime

This source subset contains the official Paraformer online/contextual models,
FSMN VAD, CT-Transformer punctuation, and their inference utilities. We retain
upstream algorithms and notices. Local compatibility changes:

- Export only the models used by the application; omit SenseVoice and its
  sentencepiece tokenizer.
- Import librosa/jieba lazily in optional file-input / word-segmented model paths.
  The application passes decoded PCM arrays and uses the character-tokenized
  punctuation checkpoint; neither dependency nor PyTorch is needed.
- Load YAML with `safe_load`; never include supplied hotword text in diagnostics.
- The contextual checkpoint publishes a quantized ASR graph and a full precision
  `model_eb.onnx` hotword embedding graph. Use that actual embedding filename.

Model downloads, fixed revisions/hashes, session orchestration and limits live
in `app/speech*.py`; the wrappers are only called with validated local models.
