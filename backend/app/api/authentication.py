from __future__ import annotations

from typing import Any
from fastapi import File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from ..api.schemas import AccountUpdateIn, LoginIn, PasswordChangeIn, RegisterIn
from ..auth import (
    authenticate,
    avatar_path,
    change_password,
    create_initial_user,
    current_user,
    delete_avatar,
    get_account,
    public_auth_config,
    register_user,
    revoke_session,
    save_avatar,
    update_account,
)
from fastapi import APIRouter


router = APIRouter()


@router.get("/auth/config")
def get_auth_config() -> dict[str, bool]:
    return public_auth_config()


@router.post("/auth/login")
def login(payload: LoginIn, request: Request) -> dict[str, Any]:
    token = authenticate(
        payload.email,
        payload.password,
        client=request.client.host if request.client else None,
    )
    user = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(user["id"]))}


@router.post("/auth/register")
def register(payload: RegisterIn) -> dict[str, Any]:
    token = register_user(payload.email, payload.password)
    user = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(user["id"]))}


@router.post("/auth/bootstrap")
def bootstrap_admin(payload: RegisterIn) -> dict[str, Any]:
    token = create_initial_user(payload.email, payload.password)
    user = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(user["id"]))}


@router.post("/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    revoke_session(request.headers.get("Authorization"))
    return Response(status_code=204)


@router.get("/auth/me")
def get_current_user(request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    return {"user": get_account(int(user["id"]))}


@router.patch("/auth/me")
def patch_current_user(payload: AccountUpdateIn, request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    return {"user": update_account(int(user["id"]), payload.display_name)}


@router.post("/auth/me/password")
def change_current_password(payload: PasswordChangeIn, request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    token = change_password(
        int(user["id"]), payload.current_password, payload.new_password,
        client=request.client.host if request.client else None,
    )
    refreshed = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(refreshed["id"]))}


@router.get("/auth/me/avatar")
def get_current_avatar(request: Request) -> Response:
    user = current_user(request.headers.get("Authorization"))
    path = avatar_path(int(user["id"]))
    if path is None:
        raise HTTPException(status_code=404, detail="还没有上传头像")
    return Response(content=path.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})


@router.post("/auth/me/avatar")
async def upload_current_avatar(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    try:
        content = await file.read(2 * 1024 * 1024 + 1)
        account = save_avatar(int(user["id"]), file.filename or "avatar.jpg", content)
    finally:
        await file.close()
    return {"user": account}


@router.delete("/auth/me/avatar")
def remove_current_avatar(request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    return {"user": delete_avatar(int(user["id"]))}
