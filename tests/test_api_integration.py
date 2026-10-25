from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text


pytestmark = pytest.mark.skipif(
    os.getenv("DOCCRAFT_INTEGRATION") != "1",
    reason="set DOCCRAFT_INTEGRATION=1 with a disposable PostgreSQL database",
)


class FakeES:
    def __init__(self) -> None:
        self.revisions: dict[str, dict] = {}

    async def put_revision(self, revision_id: str, document: dict) -> None:
        assert revision_id not in self.revisions
        self.revisions[revision_id] = document

    async def get_revision(self, revision_id: str) -> dict | None:
        return self.revisions.get(revision_id)

    async def search(self, tenant_id: str, query: str, limit: int = 20) -> list[dict]:
        return []

    async def ping(self) -> dict:
        return {"version": {"number": "fake"}}

    async def ensure_indices(self) -> None:
        return None

    async def close(self) -> None:
        return None


class FakeStorage:
    async def health(self) -> dict:
        return {"status": "ok"}

    def close(self) -> None:
        return None

    async def download(self, _file_id: str, destination: str) -> Path:
        path = Path(destination)
        path.write_bytes(b"\x89PNG\r\n\x1a\n")
        return path


def test_template_document_cas_idempotency_and_publish() -> None:
    os.environ.setdefault("DOCCRAFT_DATABASE_URL", "postgresql+psycopg://open-ikc-platform:1qaz2wsx3edc@127.0.0.1:5432/doccraft_test")
    from app.config import get_settings
    from app.db import Base, engine
    from app.main import app
    from app.models import Asset, OutboxEvent
    from app.db import SessionLocal
    from app.template_fixture import minimal_template

    get_settings.cache_clear()

    async def reset() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(reset())
    fake_es = FakeES()
    app.state.settings = get_settings()
    app.state.es = fake_es
    app.state.storage = FakeStorage()
    client = TestClient(app)
    try:
        created = client.post("/api/v1/templates", json={"source": minimal_template()})
        assert created.status_code == 201, created.text
        template_id = created.json()["id"]
        assert created.headers["ETag"] == '"1"'

        published_template = client.post(f"/api/v1/templates/{template_id}/publish")
        assert published_template.status_code == 200, published_template.text

        created_doc = client.post(
            "/api/v1/documents",
            json={"templateId": template_id, "title": "安装指南"},
        )
        assert created_doc.status_code == 201, created_doc.text
        assert created_doc.headers["ETag"] == '"1"'
        document_id = created_doc.json()["id"]

        values = {
            "title": "安装指南",
            "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "检查电源"}]}]},
        }
        saved = client.put(
            f"/api/v1/documents/{document_id}/draft",
            headers={"If-Match": '"1"', "Idempotency-Key": "save-1"},
            json={"values": values},
        )
        assert saved.status_code == 200, saved.text
        assert saved.headers["ETag"] == '"2"'
        revision_id = saved.json()["revisionId"]

        replay = client.put(
            f"/api/v1/documents/{document_id}/draft",
            headers={"If-Match": '"1"', "Idempotency-Key": "save-1"},
            json={"values": values},
        )
        assert replay.status_code == 200
        assert replay.json()["revisionId"] == revision_id

        conflict = client.put(
            f"/api/v1/documents/{document_id}/draft",
            headers={"If-Match": '"1"', "Idempotency-Key": "save-2"},
            json={"values": values},
        )
        assert conflict.status_code == 412
        assert conflict.json()["code"] == "VERSION_CONFLICT"

        published = client.post(f"/api/v1/documents/{document_id}/publish")
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"

        reading = client.get(f"/api/v1/documents/{document_id}/published")
        assert reading.status_code == 200
        assert reading.json()["content"]["title"] == "安装指南"

        async def count_outbox() -> int:
            async with SessionLocal() as session:
                result = await session.execute(text("select count(*) from outbox_events"))
                return int(result.scalar_one())

        assert asyncio.run(count_outbox()) == 1

        asset_id = "asset_" + "a" * 32

        async def add_ready_asset() -> None:
            async with SessionLocal() as session:
                session.add(
                    Asset(
                        id=asset_id,
                        tenant_id="default",
                        bucket="test",
                        object_key=f"test/{asset_id}.png",
                        pyuploadx_file_id="file_test",
                        original_name="电源.png",
                        mime_type="image/png",
                        size_bytes=8,
                        sha256="0" * 64,
                        status="READY",
                        created_by="dev-user",
                    )
                )
                await session.commit()

        async def quarantine_asset() -> None:
            async with SessionLocal() as session:
                asset = await session.get(Asset, asset_id)
                assert asset is not None
                asset.status = "QUARANTINED"
                await session.commit()

        asyncio.run(add_ready_asset())
        downloaded_asset = client.get(f"/api/v1/assets/{asset_id}/content")
        assert downloaded_asset.status_code == 200, downloaded_asset.text
        assert downloaded_asset.content == b"\x89PNG\r\n\x1a\n"
        disposition = downloaded_asset.headers["Content-Disposition"]
        assert "filename*=UTF-8''%E7%94%B5%E6%BA%90.png" in disposition
        assert disposition.isascii()

        created_asset_doc = client.post(
            "/api/v1/documents",
            json={"templateId": template_id, "title": "带媒体文档"},
        )
        assert created_asset_doc.status_code == 201, created_asset_doc.text
        asset_document_id = created_asset_doc.json()["id"]
        asset_values = {
            "title": "带媒体文档",
            "body": {
                "type": "doc",
                "content": [
                    {
                        "type": "image",
                        "attrs": {"assetId": asset_id, "alt": "电源"},
                    }
                ],
            },
        }
        saved_asset_doc = client.put(
            f"/api/v1/documents/{asset_document_id}/draft",
            headers={"If-Match": '"1"', "Idempotency-Key": "save-asset-1"},
            json={"values": asset_values},
        )
        assert saved_asset_doc.status_code == 200, saved_asset_doc.text
        asyncio.run(quarantine_asset())
        rejected = client.post(f"/api/v1/documents/{asset_document_id}/publish")
        assert rejected.status_code == 409
        assert rejected.json()["code"] == "ASSET_NOT_READY"
    finally:
        client.close()


def test_dynamic_option_source_binding_and_management() -> None:
    os.environ.setdefault("DOCCRAFT_DATABASE_URL", "postgresql+psycopg://open-ikc-platform:1qaz2wsx3edc@127.0.0.1:5432/doccraft_test")
    from app.config import get_settings
    from app.db import Base, SessionLocal, engine
    from app.main import app
    from app.seed import seed_option_sources, seed_region_cities
    from app.template_fixture import minimal_template

    get_settings.cache_clear()

    async def reset() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        async with SessionLocal() as session:
            await seed_region_cities(session)
            await seed_option_sources(session, "default", "dev-user")
            await session.commit()

    asyncio.run(reset())
    app.state.settings = get_settings()
    app.state.es = FakeES()
    app.state.storage = FakeStorage()
    client = TestClient(app)
    try:
        sources = client.get("/api/v1/option-sources")
        assert sources.status_code == 200, sources.text
        city_source = next(item for item in sources.json()["items"] if item["name"] == "浙江省地市")
        assert city_source["tableName"] == "biz_region_city"

        options = client.get(f"/api/v1/option-sources/{city_source['id']}/options", params={"query": "杭州"})
        assert options.status_code == 200, options.text
        assert options.json()["items"] == [{"value": "330100", "label": "杭州市"}]

        created_source = client.post(
            "/api/v1/option-sources",
            json={
                "name": "地市测试副本",
                "description": "集成测试",
                "enabled": True,
                "tableName": "biz_region_city",
                "valueColumn": "city_code",
                "labelColumn": "city_name",
                "searchColumns": ["city_name", "city_code"],
                "activeColumn": "enabled",
                "orderBy": ["sort_order", "city_code"],
            },
        )
        assert created_source.status_code == 201, created_source.text
        copied_source = created_source.json()
        updated_source = client.put(
            f"/api/v1/option-sources/{copied_source['id']}",
            json={
                "name": "地市测试副本",
                "description": "已停用",
                "enabled": False,
                "tableName": "biz_region_city",
                "valueColumn": "city_code",
                "labelColumn": "city_name",
                "searchColumns": ["city_name", "city_code"],
                "activeColumn": "enabled",
                "orderBy": ["sort_order", "city_code"],
            },
        )
        assert updated_source.status_code == 200, updated_source.text
        assert updated_source.json()["enabled"] is False

        source = minimal_template()
        source["fields"].append(
            {
                "id": "city_code",
                "type": "enum",
                "label": "地市",
                "requiredAt": ["publish"],
                "optionsSource": {"sourceId": city_source["id"]},
            }
        )
        source["layout"]["children"][0]["children"].append(
            {"id": "slot_city", "kind": "field", "fieldId": "city_code"}
        )
        template = client.post("/api/v1/templates", json={"source": source})
        assert template.status_code == 201, template.text
        template_id = template.json()["id"]
        assert client.post(f"/api/v1/templates/{template_id}/publish").status_code == 200

        document = client.post("/api/v1/documents", json={"templateId": template_id, "title": "杭州指南"})
        assert document.status_code == 201, document.text
        document_id = document.json()["id"]
        values = {
            "title": "杭州指南",
            "body": {"type": "doc", "content": []},
            "city_code": "330100",
        }
        saved = client.put(
            f"/api/v1/documents/{document_id}/draft",
            headers={"If-Match": '"1"', "Idempotency-Key": "dynamic-save-1"},
            json={"values": values},
        )
        assert saved.status_code == 200, saved.text
        assert client.post(f"/api/v1/documents/{document_id}/publish").status_code == 200

        invalid_document = client.post(
            "/api/v1/documents", json={"templateId": template_id, "title": "无效地市"}
        )
        invalid_id = invalid_document.json()["id"]
        invalid_values = {**values, "title": "无效地市", "city_code": "999999"}
        saved_invalid = client.put(
            f"/api/v1/documents/{invalid_id}/draft",
            headers={"If-Match": '"1"', "Idempotency-Key": "dynamic-save-2"},
            json={"values": invalid_values},
        )
        assert saved_invalid.status_code == 200, saved_invalid.text
        rejected = client.post(f"/api/v1/documents/{invalid_id}/publish")
        assert rejected.status_code == 422, rejected.text
        assert rejected.json()["diagnostics"][0]["path"] == "city_code"
    finally:
        client.close()
