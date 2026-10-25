from fastapi import APIRouter

from . import authentication, attachments, chat, conversations, home, library, model, speech, system

router = APIRouter()
for module in (authentication, attachments, chat, conversations, home, library, model, speech, system):
    router.include_router(module.router)

__all__ = ["router"]
