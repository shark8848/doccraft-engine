from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import anyio
from pyuploadx import Client, FileLifecycle, UploadClientError

from app.config import Settings


class StorageUnavailable(RuntimeError):
    pass


def safe_filename(name: str) -> str:
    base = Path(name).name.strip() or "upload.bin"
    cleaned = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+", "_", base)
    return cleaned[:180] or "upload.bin"


class PyUploadXStorage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client = Client(
            base_url=settings.pyuploadx_base_url.rstrip("/"),
            api_key=settings.pyuploadx_api_key,
            state_dir=settings.pyuploadx_state_dir,
            timeout=60.0,
        )

    def close(self) -> None:
        self._client.close()

    def _upload_sync(
        self,
        path: str,
        *,
        tenant_id: str,
        asset_id: str,
        filename: str,
        mime_type: str,
    ) -> dict[str, Any]:
        object_key = (
            f"doccraft/{self.settings.env}/{tenant_id}/assets/{asset_id}/{safe_filename(filename)}"
        )
        try:
            info = self._client.upload(
                path,
                bucket=self.settings.pyuploadx_bucket,
                object_key=object_key,
                lifecycle=FileLifecycle.permanent(),
                metadata={
                    "doccraft_asset_id": asset_id,
                    "doccraft_tenant": tenant_id,
                    "original_name": filename,
                    "content_type": mime_type,
                },
            )
        except UploadClientError as exc:
            raise StorageUnavailable(f"PyUploadX 上传失败: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"PyUploadX 上传失败: {exc}") from exc
        return {
            "id": str(info.id),
            "bucket": str(getattr(info, "bucket", self.settings.pyuploadx_bucket)),
            "object_key": str(getattr(info, "object_key", object_key)),
            "size_bytes": int(getattr(info, "size_bytes", 0) or 0),
            "etag": str(getattr(info, "etag", "") or ""),
        }

    async def upload(
        self,
        path: str,
        *,
        tenant_id: str,
        asset_id: str,
        filename: str,
        mime_type: str,
    ) -> dict[str, Any]:
        return await anyio.to_thread.run_sync(
            lambda: self._upload_sync(
                path,
                tenant_id=tenant_id,
                asset_id=asset_id,
                filename=filename,
                mime_type=mime_type,
            )
        )

    def _url_sync(self, file_id: str, expires_seconds: int) -> str | None:
        try:
            return self._client.get_download_url(file_id, expires_seconds=expires_seconds)
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"PyUploadX 获取下载地址失败: {exc}") from exc

    async def download_url(self, file_id: str, expires_seconds: int = 300) -> str | None:
        return await anyio.to_thread.run_sync(
            lambda: self._url_sync(file_id, expires_seconds)
        )

    def _download_sync(self, file_id: str, destination: str) -> Path:
        try:
            return self._client.download(file_id, destination)
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"PyUploadX 下载失败: {exc}") from exc

    async def download(self, file_id: str, destination: str) -> Path:
        return await anyio.to_thread.run_sync(
            lambda: self._download_sync(file_id, destination)
        )

    def _delete_sync(self, file_id: str) -> None:
        try:
            self._client.delete(file_id)
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"PyUploadX 删除失败: {exc}") from exc

    async def delete(self, file_id: str) -> None:
        await anyio.to_thread.run_sync(lambda: self._delete_sync(file_id))

    def _health_sync(self) -> dict[str, Any]:
        try:
            page = self._client.list_files(
                bucket=self.settings.pyuploadx_bucket, limit=1, offset=0
            )
            return {"status": "ok", "total": page.get("total", 0)}
        except Exception as exc:  # noqa: BLE001
            raise StorageUnavailable(f"PyUploadX 健康检查失败: {exc}") from exc

    async def health(self) -> dict[str, Any]:
        return await anyio.to_thread.run_sync(self._health_sync)
