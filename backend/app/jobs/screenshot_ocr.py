from __future__ import annotations

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image


MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
SUPPORTED_SCREENSHOT_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def extract_screenshot_text(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SCREENSHOT_SUFFIXES:
        raise ValueError("仅支持 PNG、JPG 和 WEBP 图片")
    if not content:
        raise ValueError("截图文件为空")
    if len(content) > MAX_SCREENSHOT_BYTES:
        raise ValueError("图片不能超过 10MB")

    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
    except Exception as exc:
        raise ValueError("无法识别该图片文件") from exc

    try:
        from docling.document_converter import DocumentConverter

        with TemporaryDirectory(prefix="careerloop-ocr-") as directory:
            path = Path(directory) / f"image{suffix}"
            path.write_bytes(content)
            result = DocumentConverter().convert(path)
            text = result.document.export_to_markdown()
    except Exception as exc:
        raise ValueError("本地图片文字识别失败，请上传更清晰的截图或改为粘贴文字") from exc

    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if len(normalized) < 10:
        raise ValueError("图片中没有识别到足够文字，请换一张清晰截图或直接粘贴内容")
    return normalized[:30_000]
