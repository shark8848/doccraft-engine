from __future__ import annotations

import io
import os
import time
import uuid

import httpx
from PIL import Image


BASE = os.getenv("DOCCRAFT_BASE_URL", "http://127.0.0.1:8100")


def check(response: httpx.Response, expected: int = 200) -> httpx.Response:
    if response.status_code != expected:
        raise RuntimeError(f"{response.request.method} {response.request.url} -> {response.status_code}: {response.text}")
    return response


def active_field_ids(source: dict) -> set[str]:
    ids: set[str] = set()

    def walk(block: dict) -> None:
        if block.get("fieldId"):
            ids.add(block["fieldId"])
        for child in block.get("children", []):
            walk(child)

    walk(source["layout"])
    indexing = source.get("indexing", {})
    ids.update(
        value
        for value in (
            indexing.get("titleField", ""),
            indexing.get("summaryField", ""),
            indexing.get("fullTextField", ""),
        )
        if value
    )
    return ids


def smoke_values(source: dict, asset_id: str, stamp: int) -> dict:
    fields = {field["id"]: field for field in source["fields"]}
    rich_text = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "先检查电源，再执行启动步骤。"}]},
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableCell", "attrs": {"header": True}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "步骤"}]}]},
                            {"type": "tableCell", "attrs": {"header": True}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "操作"}]}]},
                        ],
                    },
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "1"}]}]},
                            {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "长按复位键"}]}]},
                        ],
                    },
                ],
            },
        ],
    }
    values: dict = {}
    for field_id in active_field_ids(source):
        field = fields[field_id]
        field_type = field["type"]
        if field_type == "richtext":
            values[field_id] = rich_text
        elif field_type == "asset":
            values[field_id] = asset_id
        elif field_type == "enum":
            values[field_id] = field["options"][0]["value"]
        elif field_type == "array":
            values[field_id] = ["示例"]
        elif field_type == "object":
            values[field_id] = {"value": "示例"}
        elif field_type == "number":
            values[field_id] = 1
        elif field_type == "boolean":
            values[field_id] = True
        elif field_type == "date":
            values[field_id] = "2026-12-31"
        else:
            values[field_id] = f"端到端验证 {stamp}"
    return values


def main() -> None:
    with httpx.Client(base_url=BASE, timeout=60.0) as client:
        ready = check(client.get("/readyz")).json()
        assert ready["status"] == "ready", ready

        templates = check(client.get("/api/v1/templates")).json()["items"]
        template = next((item for item in templates if item["status"] == "published"), None)
        assert template is not None, "没有已发布模板"

        stamp = int(time.time())
        document = check(
            client.post(
                "/api/v1/documents",
                json={"templateId": template["id"], "title": f"端到端验证 {stamp}"},
            ),
            201,
        ).json()
        document_id = document["id"]
        detail = check(client.get(f"/api/v1/documents/{document_id}"))
        etag = detail.headers["ETag"]
        template_source = document["templateSource"]

        buffer = io.BytesIO()
        Image.new("RGB", (32, 32), "#07c05f").save(buffer, format="PNG")
        uploaded = check(
            client.post(
                "/api/v1/assets",
                files={"file": ("doccraft-smoke.png", buffer.getvalue(), "image/png")},
            ),
            201,
        ).json()
        asset_id = uploaded["id"]
        for _ in range(40):
            asset = check(client.get(f"/api/v1/assets/{asset_id}")).json()
            if asset["status"] != "SCANNING":
                break
            time.sleep(0.5)
        assert asset["status"] == "READY", asset
        content = check(client.get(f"/api/v1/assets/{asset_id}/content"))
        assert content.content.startswith(b"\x89PNG"), "媒体代理下载不是 PNG"

        values = smoke_values(template_source, asset_id, stamp)
        saved = check(
            client.put(
                f"/api/v1/documents/{document_id}/draft",
                headers={"If-Match": etag, "Idempotency-Key": uuid.uuid4().hex},
                json={"values": values},
            )
        ).json()
        assert saved["revisionId"]

        published = check(client.post(f"/api/v1/documents/{document_id}/publish")).json()
        assert published["status"] == "published"

        title_field = template_source["indexing"]["titleField"]
        search_query = str(values.get(title_field) or f"端到端验证 {stamp}")
        hits: list[dict] = []
        for _ in range(20):
            hits = check(client.get("/api/v1/search", params={"q": search_query})).json()["items"]
            if any(item["documentId"] == document_id for item in hits):
                break
            time.sleep(0.5)
        assert any(item["documentId"] == document_id for item in hits), hits

        reading = check(client.get(f"/api/v1/documents/{document_id}/published")).json()
        rich_field_id = next(
            field_id
            for field_id in active_field_ids(template_source)
            if next(field for field in template_source["fields"] if field["id"] == field_id)["type"] == "richtext"
        )
        assert reading["content"][rich_field_id]["content"][1]["type"] == "table"
        print(
            "E2E OK",
            f"template={template['id']}",
            f"document={document_id}",
            f"asset={asset_id}:READY",
            f"revision={saved['revisionId']}",
            f"generation={published['generation']}",
            f"search_hits={len(hits)}",
        )


if __name__ == "__main__":
    main()
