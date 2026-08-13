"""Knowledge domain: local deterministic vector indexing and retrieval."""

from .service import delete_document, index_document, list_knowledge_chunks, search_knowledge

__all__ = ["delete_document", "index_document", "list_knowledge_chunks", "search_knowledge"]
