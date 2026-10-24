from __future__ import annotations

import asyncio
import logging
import os
import signal
import tempfile
from datetime import datetime, timezone

from PIL import Image
from sqlalchemy import select

from app.compiler import build_search_document
from app.config import get_settings
from app.db import SessionLocal
from app.es import ElasticsearchStore
from app.models import Asset, Document, OutboxEvent, Revision, TemplateVersion
from app.storage import PyUploadXStorage, StorageUnavailable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("doccraft.worker")


async def process_assets(storage: PyUploadXStorage) -> bool:
    worked = False
    async with SessionLocal() as session:
        result = await session.execute(
            select(Asset)
            .where(Asset.status == "SCANNING")
            .order_by(Asset.created_at)
            .limit(4)
            .with_for_update(skip_locked=True)
        )
        assets = list(result.scalars().all())
        if not assets:
            return False
        for asset in assets:
            worked = True
            path = ""
            try:
                suffix = os.path.splitext(asset.original_name)[1][:16]
                handle, path = tempfile.mkstemp(prefix="doccraft-scan-", suffix=suffix)
                os.close(handle)
                await storage.download(asset.pyuploadx_file_id, path)
                if asset.mime_type.startswith("image/"):
                    with Image.open(path) as image:
                        image.verify()
                    with Image.open(path) as image:
                        if image.width * image.height > 40_000_000:
                            raise ValueError("图片像素超过限制")
                        if image.format not in {"PNG", "JPEG", "WEBP", "GIF"}:
                            raise ValueError(f"不允许的图片格式: {image.format}")
                asset.status = "READY"
                asset.error_message = None
                logger.info("asset ready id=%s", asset.id)
            except Exception as exc:  # noqa: BLE001
                asset.status = "QUARANTINED"
                asset.error_message = str(exc)[:2000]
                logger.warning("asset quarantined id=%s err=%s", asset.id, exc)
            finally:
                if path:
                    try:
                        os.unlink(path)
                    except FileNotFoundError:
                        pass
        await session.commit()
    return worked


async def process_outbox(es: ElasticsearchStore) -> bool:
    async with SessionLocal() as session:
        result = await session.execute(
            select(OutboxEvent)
            .where(OutboxEvent.status == "PENDING")
            .order_by(OutboxEvent.created_at)
            .limit(8)
            .with_for_update(skip_locked=True)
        )
        events = list(result.scalars().all())
        if not events:
            return False
        for event in events:
            event.status = "PROCESSING"
            event.attempts += 1
            await session.commit()
            try:
                if event.event_type == "publish.index":
                    await _index_publication(session, es, event)
                event.status = "DONE"
                event.last_error = None
                logger.info("outbox done id=%s type=%s", event.id, event.event_type)
            except Exception as exc:  # noqa: BLE001
                logger.warning("outbox failed id=%s err=%s", event.id, exc)
                event.status = "FAILED" if event.attempts >= 8 else "PENDING"
                event.last_error = str(exc)[:2000]
            await session.commit()
    return True


async def _index_publication(session, es: ElasticsearchStore, event: OutboxEvent) -> None:
    document = await session.get(Document, event.payload["documentId"])
    revision = await session.get(Revision, event.payload["revisionId"])
    if document is None or revision is None:
        raise RuntimeError("发布文档或 revision 不存在")
    version = await session.get(TemplateVersion, revision.template_version_id)
    if version is None:
        raise RuntimeError("模板版本不存在")
    revision_doc = await es.get_revision(revision.id)
    if revision_doc is None:
        raise RuntimeError("ES revision 不存在")
    search_doc = build_search_document(
        document_id=document.id,
        tenant_id=document.tenant_id,
        title=document.title,
        template_version_id=version.id,
        values=revision_doc.get("values", {}),
        source=version.source,
        generation=int(event.payload.get("generation") or 1),
    )
    search_doc["contentHash"] = revision.content_hash
    await es.index_published(document.id, search_doc)


async def run() -> None:
    settings = get_settings()
    es = ElasticsearchStore(settings)
    storage = PyUploadXStorage(settings)
    stop = asyncio.Event()

    if settings.auto_init_indices:
        await es.ensure_indices()

    def request_stop(*_: object) -> None:
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, request_stop)
    logger.info("DocCraft worker started env=%s", settings.env)
    try:
        while not stop.is_set():
            worked = await process_assets(storage)
            worked = await process_outbox(es) or worked
            if not worked:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=settings.worker_poll_seconds)
                except TimeoutError:
                    pass
    finally:
        storage.close()
        await es.close()
        logger.info("DocCraft worker stopped")


if __name__ == "__main__":
    asyncio.run(run())
