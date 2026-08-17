import os

# Keep unit tests offline and deterministic. Production default remains auto/fastembed.
os.environ.setdefault("EMBEDDING_BACKEND", "hash")
