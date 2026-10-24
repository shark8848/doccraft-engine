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

        values = {
            "title": f"端到端验证 {stamp}",
            "summary": "通过 PyUploadX 上传图片并发布到 Elasticsearch。",
            "body": {
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
                    {"type": "image", "attrs": {"assetId": asset_id, "alt": "验证图片"}},
                ],
            },
        }
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

        hits: list[dict] = []
        for _ in range(20):
            hits = check(client.get("/api/v1/search", params={"q": "复位"})).json()["items"]
            if any(item["documentId"] == document_id for item in hits):
                break
            time.sleep(0.5)
        assert any(item["documentId"] == document_id for item in hits), hits

        reading = check(client.get(f"/api/v1/documents/{document_id}/published")).json()
        assert reading["content"]["title"] == values["title"]
        assert reading["content"]["body"]["content"][1]["type"] == "table"
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
