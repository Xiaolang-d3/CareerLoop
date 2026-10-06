from __future__ import annotations

from typing import Any, Literal
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from ..library.repository import save_metadata
from ..library.knowledge import list_knowledge, merge_knowledge, propose_knowledge, review_knowledge
from ..library.sources import (
    create_text_source,
    delete_source,
    get_source,
    get_source_file,
    import_file_source,
    list_sources,
    update_source,
)
from ..library.service import get_library
from ..library.organization import FolderIn, OrganizationIn, create_folder, list_folders, organize_source
from ..library.conversations import LibraryConversationIn, prepare_conversation
from ..documents import service as document_service
from .schemas import (
    LibraryKnowledgeIn,
    LibraryKnowledgeMergeIn,
    LibraryKnowledgeReviewIn,
    LibrarySourceIn,
    LibrarySourceUpdateIn,
    LibraryMetadataIn,
    PrivacyScanIn,
)


router = APIRouter()


@router.post("/library/conversations")
def library_conversation_post(payload: LibraryConversationIn) -> dict[str, Any]:
    try:
        return prepare_conversation(payload.source_ids)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="文件暂时无法加入对话，请稍后重试") from exc


@router.post("/library/document/parse")
async def parse_library_document(
    file: UploadFile = File(...),
    mode: str = Form(default="fast"),
) -> dict[str, Any]:
    filename = (file.filename or "document").strip()
    try:
        content = await file.read()
        result = document_service.parse_document_upload(filename, content, mode)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="无法解析该资料，请确认文件或截图清晰、未损坏且包含可识别文字",
        ) from exc
    finally:
        await file.close()


@router.post("/library/privacy/scan")
def scan_library_privacy(payload: PrivacyScanIn) -> dict[str, Any]:
    return document_service.scan_document_privacy(payload.text)


@router.get("/library")
def library_get() -> dict[str, Any]:
    return get_library()


@router.put("/library")
def library_put(payload: LibraryMetadataIn) -> dict[str, Any]:
    save_metadata(**payload.model_dump())
    return get_library()


@router.get("/library/sources")
def library_sources_get(q: str = "") -> list[dict[str, Any]]:
    sources = list_sources()
    if not q.strip():
        return sources
    query = q.strip().casefold()
    return [source for source in sources if query in f"{source['title']} {source['original_filename']} {get_source(source['id'])['content']}".casefold()]


@router.get("/library/folders")
def library_folders_get() -> list[dict[str, Any]]:
    return list_folders()


@router.post("/library/folders")
def library_folders_post(payload: FolderIn) -> dict[str, Any]:
    try:
        return create_folder(payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/library/sources/{source_id}/organization")
def library_source_organize(source_id: int, payload: OrganizationIn) -> dict[str, Any]:
    try:
        return organize_source(source_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.post("/library/sources")
def library_sources_post(payload: LibrarySourceIn) -> dict[str, Any]:
    try:
        source = create_text_source(
            title=payload.title,
            content=payload.content,
            source_uri=payload.source_uri,
            privacy_mode=payload.privacy_mode,
        )
        return {"source": source, "proposals": []}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/sources/import")
async def library_sources_import(
    files: list[UploadFile] = File(...),
    mode: str = Form(default="fast"),
    privacy_mode: Literal["redacted", "original"] = Form(default="redacted"),
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for file in files:
        filename = (file.filename or "document").strip()
        try:
            source = import_file_source(
                filename=filename,
                content_bytes=await file.read(),
                mode=mode,
                privacy_mode=privacy_mode,
            )
            results.append({"filename": filename, "ok": True, "source": source})
        except Exception as exc:
            results.append({
                "filename": filename,
                "ok": False,
                "error": str(exc) if isinstance(exc, ValueError) else "无法解析或保存该资料",
            })
        finally:
            await file.close()
    return {"results": results}


@router.get("/library/sources/{source_id}")
def library_source_get(source_id: int) -> dict[str, Any]:
    try:
        return get_source(source_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/library/sources/{source_id}/file")
def library_source_file_get(source_id: int) -> FileResponse:
    try:
        path, filename, mime_type = get_source_file(source_id)
        return FileResponse(path, filename=filename, media_type=mime_type)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/library/sources/{source_id}")
def library_source_patch(source_id: int, payload: LibrarySourceUpdateIn) -> dict[str, Any]:
    try:
        return update_source(
            source_id,
            **payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        status_code = 404 if "不存在" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.delete("/library/sources/{source_id}")
def library_source_delete(source_id: int) -> dict[str, bool]:
    try:
        return {"deleted": delete_source(source_id)}
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.get("/library/facts")
def library_facts_get(
    status: Literal["pending", "confirmed", "disputed", "retracted"] | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    try:
        return list_knowledge(status=status, category=category)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/facts")
def library_facts_post(payload: LibraryKnowledgeIn) -> dict[str, Any]:
    try:
        return propose_knowledge(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/facts/{fact_id}/review")
def library_fact_review(
    fact_id: int,
    payload: LibraryKnowledgeReviewIn,
) -> dict[str, Any]:
    try:
        result = review_knowledge(fact_id, action=payload.action, statement=payload.statement)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.post("/library/facts/{fact_id}/merge")
def library_fact_merge(
    fact_id: int,
    payload: LibraryKnowledgeMergeIn,
) -> dict[str, Any]:
    try:
        return merge_knowledge(fact_id, payload.target_fact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc
