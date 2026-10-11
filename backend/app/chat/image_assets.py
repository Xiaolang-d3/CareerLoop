"""Account-local generated images and durable, non-retryable generation attempts."""
from __future__ import annotations

import base64
import json
import re
import uuid
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

from ..db import connect, json_dump
from ..domain import ModelResponse
from ..models import ModelProviderError
from ..workspace import resolve_document_dir


def image_generation_intent(text: str) -> bool:
    # Only an instruction in this turn enables the billed native tool. Quoted
    # documents, past turns and requests to explain image generation do not.
    first = text.strip().split("\n", 1)[0]
    if re.search(r"(?:图片|图像)(?:的(?:原理|功能|接口|能力)|功能|接口|能力|是什么|支持吗|怎么用)", first):
        return False
    if re.match(r"^(?:能否|可以|能不能|你能|你可以).*(?:吗|[?？])$", first):
        return False
    if re.search(r"(?:思维导图|流程图|时序图|架构图|折线图|柱状图|饼图|Mermaid)", first, re.I) and not re.search(r"图片|图像|插画|海报", first):
        return False
    if re.match(r"^(?:请|帮我)?生成(?:图片|图像)(?:需要|有什么|怎么|是否)", first):
        return False
    return bool(re.match(r"^(?:(?:请|帮我|给我|能否|可以|用\s*Grok|为我)\s*)*(?:画(?:一|个|张|出)|绘制|生成.{0,18}(?:图片|图像|插画|海报|壁纸|封面)|设计.{0,12}(?:海报|插画))", first, re.I)
                or re.match(r"^(?:please\s+)?(?:generate|create|draw|paint)\s+(?:an?\s+)?(?:image|picture|illustration|poster|painting|photo)\b", first, re.I))


def begin_generation(operation_id: str, conversation_id: int, selection: dict[str, Any], db_path=None) -> dict | None:
    fields = ("profile_id", "profile_revision", "connection_id", "connection_revision", "model_name", "model_protocol")
    selection = {**{k: selection[k] for k in fields if k in selection},
                 **({"stages": {name: {k: stage[k] for k in fields if k in stage} for name, stage in selection["stage_selections"].items()}}
                    if selection.get("stage_selections") else {})}
    with connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM chat_image_operations WHERE id=?", (operation_id,)).fetchone()
        if row:
            if row["conversation_id"] != conversation_id:
                raise ModelProviderError("image_operation_conflict", "生图任务不属于当前对话")
            if json.loads(row["selection_json"]) != selection:
                raise ModelProviderError("image_operation_conflict", "生图任务的模型配置版本不匹配")
            if row["status"] == "done":
                return json.loads(row["result_json"])
            raise ModelProviderError("image_generation_uncertain", "上次生图请求的执行结果尚未确认，已阻止自动重复生成。请查看服务记录后重新发起请求")
        conn.execute("INSERT INTO chat_image_operations (id,conversation_id,selection_json) VALUES (?,?,?)",
                     (operation_id, conversation_id, json_dump(selection)))
    return None


def _root(db_path=None) -> Path:
    return resolve_document_dir(db_path) / "chat-images"


def _confined(root: Path, path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()) or resolved == root.resolve():
        raise ValueError("图片路径不可用")
    return resolved


def persist_images(operation_id: str, response: ModelResponse, model_name: str, db_path=None) -> dict:
    if not 1 <= len(response.images) <= 4:
        raise ModelProviderError("image_generation_unavailable", "服务没有返回生成的图片，请确认当前 Grok 模型及中转服务支持 image_generation 工具")
    prepared = []
    seen: set[str] = set()
    try:
        for image in response.images:
            if image.item_id in seen:
                raise ValueError("重复的图片输出")
            seen.add(image.item_id)
            encoded = image.base64_data.get_secret_value()
            if len(encoded) > 28_000_000:
                raise ValueError("生成的图片超过 20 MB")
            data = base64.b64decode(encoded, validate=True)
            if len(data) > 20_000_000:
                raise ValueError("生成的图片超过 20 MB")
            with Image.open(BytesIO(data)) as decoded:
                if decoded.format not in {"PNG", "JPEG", "WEBP"} or decoded.width * decoded.height > 40_000_000:
                    raise ValueError("生成图片的格式或尺寸不受支持")
                mime, extension = {"PNG": ("image/png", "png"), "JPEG": ("image/jpeg", "jpg"), "WEBP": ("image/webp", "webp")}[decoded.format]
                width, height = decoded.size
                decoded.verify()
            aid = uuid.uuid4().hex
            asset = {"id": aid, "origin": "generated", "kind": "image", "original_filename": f"生成图片-{len(prepared)+1}.{extension}",
                     "content_type": mime, "size_bytes": len(data), "width": width, "height": height,
                     "sha256": sha256(data).hexdigest(), "parse_status": "parsed", "model_name": model_name}
            prepared.append((image.item_id, asset, data))
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ModelProviderError("invalid_image_output", "生图服务返回的图片无效或过大，未保存；不会自动重新生成") from exc
    written: list[Path] = []
    try:
        with connect(db_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            operation = conn.execute("SELECT * FROM chat_image_operations WHERE id=?", (operation_id,)).fetchone()
            if operation is None:
                raise ValueError("生图任务不存在")
            if operation["status"] == "done":
                return json.loads(operation["result_json"])
            root = _root(db_path)
            if root.is_symlink():
                raise ValueError("图片目录不可用")
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            root.chmod(0o700)
            for item_id, asset, data in prepared:
                suffix = Path(asset["original_filename"]).suffix
                target = _confined(root, root / f"{asset['id']}{suffix}")
                # Exclusive creation, with restrictive permissions from the start.
                import os
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                written.append(target)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
                conn.execute("INSERT INTO chat_image_assets (id,operation_id,conversation_id,provider_item_id,stored_path,metadata_json) VALUES (?,?,?,?,?,?)",
                             (asset["id"], operation_id, operation["conversation_id"], item_id, target.relative_to(resolve_document_dir(db_path)).as_posix(), json_dump(asset)))
            assets = [asset for _, asset, _ in prepared]
            blocks = [{"type": "image", "asset_id": assets[b["index"]]["id"]} if b["type"] == "image" else b for b in response.output_blocks]
            if not blocks:
                blocks = ([{"type": "text", "text": response.content}] if response.content else []) + [{"type": "image", "asset_id": asset["id"]} for asset in assets]
            result = {"content": response.content, "assets": assets, "output_blocks": blocks}
            conn.execute("UPDATE chat_image_operations SET status='done',result_json=? WHERE id=?", (json_dump(result), operation_id))
        return result
    except OSError as exc:
        for path in written:
            path.unlink(missing_ok=True)
        raise ModelProviderError("image_storage_failed", "图片已生成，但本地保存失败。请检查磁盘；不会自动重新生成") from exc
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise


def asset_metadata(asset_id: str, db_path=None) -> dict:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM chat_image_assets WHERE id=?", (asset_id,)).fetchone()
    if row is None:
        raise ValueError("生成图片不存在")
    return {**json.loads(row["metadata_json"]), "conversation_id": row["conversation_id"], "message_id": row["message_id"]}


def asset_file(asset_id: str, db_path=None) -> tuple[Path, str, str]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT stored_path,metadata_json FROM chat_image_assets WHERE id=?", (asset_id,)).fetchone()
    if row is None:
        raise ValueError("生成图片不存在")
    path = _confined(_root(db_path), resolve_document_dir(db_path) / row["stored_path"])
    if _root(db_path).is_symlink():
        raise ValueError("图片目录不可用")
    if not path.is_file():
        raise ValueError("生成图片原文件不可用")
    metadata = json.loads(row["metadata_json"])
    return path, metadata["original_filename"], metadata["content_type"]


def asset_thumbnail(asset_id: str, db_path=None) -> bytes:
    path, _, _ = asset_file(asset_id, db_path)
    with Image.open(path) as img:
        if img.width * img.height > 40_000_000:
            raise ValueError("图片尺寸过大")
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
        img.thumbnail((960, 640))
        output = BytesIO()
        img.save(output, "WEBP", quality=82)
        return output.getvalue()


def delete_images(conversation_id: int, *, message_cutoff: int | None = None, db_path=None) -> None:
    with connect(db_path) as conn:
        condition = "conversation_id=?" + (" AND message_id>=?" if message_cutoff is not None else "")
        args = (conversation_id, message_cutoff) if message_cutoff is not None else (conversation_id,)
        rows = conn.execute(f"SELECT id,operation_id,stored_path FROM chat_image_assets WHERE {condition}", args).fetchall()
        for row in rows:
            path = _confined(_root(db_path), resolve_document_dir(db_path) / row["stored_path"])
            path.unlink(missing_ok=True)
            conn.execute("DELETE FROM chat_image_assets WHERE id=?", (row["id"],))
        # Keep attempt markers on rewind: reconnecting the same paid run must not regenerate.
        if message_cutoff is None:
            conn.execute("DELETE FROM chat_image_operations WHERE conversation_id=?", (conversation_id,))
