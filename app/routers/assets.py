from __future__ import annotations

import hashlib
import mimetypes
import os
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.db import get_session
from app.deps import Identity, get_identity
from app.models import Asset, new_id
from app.storage import StorageUnavailable, safe_filename
from app.utils import iso_utc

router = APIRouter(prefix="/assets", tags=["assets"])


def asset_view(asset: Asset) -> dict:
    return {
        "id": asset.id,
        "originalName": asset.original_name,
        "mimeType": asset.mime_type,
        "sizeBytes": asset.size_bytes,
        "sha256": asset.sha256,
        "status": asset.status,
        "bucket": asset.bucket,
        "objectKey": asset.object_key,
        "contentUrl": f"/api/v1/assets/{asset.id}/content",
        "createdAt": iso_utc(asset.created_at),
        "errorMessage": asset.error_message,
    }


@router.get("")
async def list_assets(
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(Asset)
        .where(Asset.tenant_id == identity.tenant_id)
        .order_by(Asset.created_at.desc())
        .limit(200)
    )
    return {"items": [asset_view(item) for item in result.scalars().all()]}


@router.post("", status_code=201)
async def upload_asset(
    request: Request,
    file: UploadFile = File(...),
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    settings = request.app.state.settings
    filename = file.filename or "upload.bin"
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if mime_type not in settings.allowed_mime_types:
        raise HTTPException(
            status_code=415,
            detail={
                "code": "UNSUPPORTED_MEDIA_TYPE",
                "message": f"不支持的媒体类型: {mime_type}",
            },
        )
    asset_id = new_id("asset")
    digest = hashlib.sha256()
    size = 0
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="doccraft-", suffix=".upload", delete=False) as sink:
            temp_path = sink.name
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.media_max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail={"code": "FILE_TOO_LARGE", "message": "文件超过大小限制"},
                    )
                digest.update(chunk)
                sink.write(chunk)
        if size == 0:
            raise HTTPException(
                status_code=400,
                detail={"code": "EMPTY_FILE", "message": "上传文件为空"},
            )
        try:
            info = await request.app.state.storage.upload(
                temp_path,
                tenant_id=identity.tenant_id,
                asset_id=asset_id,
                filename=filename,
                mime_type=mime_type,
            )
        except StorageUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "STORAGE_UNAVAILABLE", "message": str(exc)},
            ) from exc
        if int(info.get("size_bytes") or size) != size:
            raise HTTPException(
                status_code=502,
                detail={"code": "STORAGE_SIZE_MISMATCH", "message": "存储服务返回大小与上传不一致"},
            )
        asset = Asset(
            id=asset_id,
            tenant_id=identity.tenant_id,
            bucket=info["bucket"],
            object_key=info["object_key"],
            pyuploadx_file_id=info["id"],
            original_name=filename,
            mime_type=mime_type,
            size_bytes=size,
            sha256=digest.hexdigest(),
            status="SCANNING" if mime_type.startswith("image/") else "READY",
            created_by=identity.user_id,
        )
        session.add(asset)
        await session.commit()
        return asset_view(asset)
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


@router.get("/{asset_id}")
async def get_asset(
    asset_id: str,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "资产不存在"})
    return asset_view(asset)


@router.get("/{asset_id}/content")
async def get_asset_content(
    asset_id: str,
    request: Request,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
):
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "资产不存在"})
    if asset.status != "READY":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ASSET_NOT_READY",
                "message": "资产仍在处理中或未通过校验",
                "status": asset.status,
            },
        )
    suffix = Path(asset.original_name).suffix[:16]
    handle, temp_path = tempfile.mkstemp(prefix="doccraft-download-", suffix=suffix)
    os.close(handle)
    try:
        await request.app.state.storage.download(asset.pyuploadx_file_id, temp_path)
    except StorageUnavailable as exc:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise HTTPException(
            status_code=503,
            detail={"code": "STORAGE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    filename = safe_filename(asset.original_name)
    suffix = Path(filename).suffix[:16]
    if not suffix.isascii():
        suffix = ""
    fallback_name = f"doccraft-{asset.id}{suffix}"
    return FileResponse(
        temp_path,
        media_type=asset.mime_type,
        headers={
            "Content-Disposition": f"inline; filename=\"{fallback_name}\"; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(lambda: Path(temp_path).unlink(missing_ok=True)),
    )
