"""Load the bundled image-design guidance only for an authorized image run.

Adapted from the imagegen skill's prompt-structure and specificity guidance.
This is a local prompt resource, not a tool installer or another model call.
"""
from pathlib import Path

from ..models.base import ModelProviderError


IMAGE_DESIGN_SKILL_PATH = Path(__file__).with_name("skills") / "image-design" / "SKILL.md"


def image_design_prompt(user_prompt: str) -> str:
    try:
        definition = IMAGE_DESIGN_SKILL_PATH.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ModelProviderError("image_design_skill_unavailable", "图片设计技能无法加载，请修复安装后重试；尚未调用生图服务") from exc
    header, separator, guidance = definition.partition("\n---\n")
    if not definition.startswith("---\n") or not separator or not guidance.strip():
        raise ModelProviderError("image_design_skill_unavailable", "图片设计技能内容无效，请修复安装后重试；尚未调用生图服务")
    metadata = dict(line.split(": ", 1) for line in header.splitlines()[1:] if ": " in line)
    if metadata.get("name") != "image-design" or not metadata.get("version", "").isdigit():
        raise ModelProviderError("image_design_skill_unavailable", "图片设计技能版本无效，请修复安装后重试；尚未调用生图服务")
    return f"{user_prompt.strip()}\n\n【图片设计技能 image-design · v{metadata['version']}】\n{guidance.strip()}"
