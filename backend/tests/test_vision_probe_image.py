import base64
import struct
import zlib

from app.models import anthropic_messages, gemini_generate_content, ollama_chat, openai_compatible, openai_responses
from app.models.validation import is_vision_rejection


def test_all_protocols_share_a_valid_probe_image_above_minimum_dimensions():
    image = openai_compatible._TINY_PNG_DATA_URL
    for module in (anthropic_messages, gemini_generate_content, ollama_chat, openai_responses):
        assert module._TINY_PNG_DATA_URL == image
    payload = base64.b64decode(image.split(",", 1)[1], validate=True)
    assert payload[:8] == b"\x89PNG\r\n\x1a\n"
    width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload[16:29])
    assert (width, height, depth, color, compression, filtering, interlace) == (32, 32, 8, 2, 0, 0, 0)
    offset = 8
    compressed = b""
    while offset < len(payload):
        size = struct.unpack(">I", payload[offset:offset + 4])[0]
        kind = payload[offset + 4:offset + 8]
        data = payload[offset + 8:offset + 8 + size]
        checksum = struct.unpack(">I", payload[offset + 8 + size:offset + 12 + size])[0]
        assert checksum == zlib.crc32(kind + data)
        if kind == b"IDAT":
            compressed += data
        offset += size + 12
    assert zlib.decompress(compressed) == (b"\0" + b"\xff\xff\xff" * width) * height


def test_dimension_rejection_is_not_evidence_of_missing_vision_support():
    assert not is_vision_rejection("Image dimensions 1x1 are too small. Both width and height must be at least 8 pixels.", 400)
