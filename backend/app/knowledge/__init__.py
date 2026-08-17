"""Knowledge domain: local on-device vector indexing and retrieval."""

from .embeddings import get_embedder, reset_embedder, set_embedder
from .service import (
    delete_document,
    index_chunks,
    index_document,
    knowledge_index_info,
    list_knowledge_chunks,
    rebuild_knowledge_index,
    search_knowledge,
)

__all__ = [
    "delete_document",
    "get_embedder",
    "index_chunks",
    "index_document",
    "knowledge_index_info",
    "list_knowledge_chunks",
    "rebuild_knowledge_index",
    "reset_embedder",
    "search_knowledge",
    "set_embedder",
]
