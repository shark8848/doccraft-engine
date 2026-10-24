from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException, Request

from app.config import get_settings


@dataclass(frozen=True)
class Identity:
    tenant_id: str
    user_id: str
    role: str


async def get_identity(
    request: Request,
    x_doccraft_user: str | None = Header(default=None),
    x_doccraft_tenant: str | None = Header(default=None),
    x_doccraft_role: str | None = Header(default=None),
) -> Identity:
    settings = get_settings()
    user = x_doccraft_user or (settings.default_user if settings.auth_mode == "dev" else "")
    tenant = x_doccraft_tenant or (
        settings.default_tenant if settings.auth_mode == "dev" else ""
    )
    role = x_doccraft_role or (settings.default_role if settings.auth_mode == "dev" else "")
    if not user or not tenant or not role:
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHENTICATED", "message": "缺少开发身份头或生产身份未接入"},
        )
    request.state.identity = Identity(tenant_id=tenant, user_id=user, role=role)
    return request.state.identity


def require_publisher(identity: Identity) -> None:
    if identity.role not in {"publisher", "template_admin", "kb_admin", "tenant_admin"}:
        raise HTTPException(
            status_code=403,
            detail={"code": "FORBIDDEN", "message": "当前身份没有发布权限"},
        )


def parse_etag(value: str | None) -> int | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned.startswith("W/"):
        cleaned = cleaned[2:]
    cleaned = cleaned.strip('"')
    try:
        return int(cleaned)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_ETAG", "message": "If-Match 必须是版本号"},
        ) from exc
