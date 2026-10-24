from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class SearchUnavailable(RuntimeError):
    pass


class ElasticsearchStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.es_url.rstrip("/"),
            auth=(settings.es_username, settings.es_password),
            verify=settings.es_verify_tls,
            timeout=settings.es_timeout,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            return await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise SearchUnavailable(f"Elasticsearch 不可用: {exc}") from exc

    async def ensure_indices(self) -> None:
        mappings = {
            "dynamic": "strict",
            "properties": {
                "documentId": {"type": "keyword"},
                "tenantId": {"type": "keyword"},
                "revisionId": {"type": "keyword"},
                "revisionNo": {"type": "long"},
                "title": {"type": "text", "analyzer": "cjk"},
                "summary": {"type": "text", "analyzer": "cjk"},
                "fullText": {"type": "text", "analyzer": "cjk"},
                "values": {"type": "object", "enabled": False},
                "templateVersionId": {"type": "keyword"},
                "contentHash": {"type": "keyword"},
                "status": {"type": "keyword"},
                "generation": {"type": "long"},
                "fieldTypes": {"type": "object", "enabled": False},
                "operationId": {"type": "keyword"},
                "createdAt": {"type": "date"},
            },
        }
        for index in (self.settings.revision_index, self.settings.published_index):
            response = await self._request("HEAD", f"/{index}")
            if response.status_code == 200:
                continue
            if response.status_code != 404:
                raise SearchUnavailable(
                    f"检查索引 {index} 失败: HTTP {response.status_code} {response.text}"
                )
            response = await self._request(
                "PUT",
                f"/{index}",
                json={
                    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
                    "mappings": mappings,
                },
            )
            if response.status_code not in (200, 201):
                raise SearchUnavailable(
                    f"创建索引 {index} 失败: HTTP {response.status_code} {response.text}"
                )

    async def ping(self) -> dict[str, Any]:
        response = await self._request("GET", "/")
        response.raise_for_status()
        return response.json()

    async def put_revision(self, revision_id: str, document: dict[str, Any]) -> None:
        response = await self._request(
            "PUT",
            f"/{self.settings.revision_index}/_doc/{revision_id}",
            params={"op_type": "create", "refresh": "wait_for"},
            json=document,
        )
        if response.status_code not in (200, 201):
            raise SearchUnavailable(
                f"写入 revision 失败: HTTP {response.status_code} {response.text}"
            )

    async def get_revision(self, revision_id: str) -> dict[str, Any] | None:
        response = await self._request(
            "GET", f"/{self.settings.revision_index}/_doc/{revision_id}"
        )
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise SearchUnavailable(
                f"读取 revision 失败: HTTP {response.status_code} {response.text}"
            )
        return response.json().get("_source")

    async def index_published(self, document_id: str, document: dict[str, Any]) -> None:
        generation = int(document.get("generation") or 1)
        response = await self._request(
            "PUT",
            f"/{self.settings.published_index}/_doc/{document_id}",
            params={
                "version": generation,
                "version_type": "external_gte",
                "refresh": "wait_for",
            },
            json=document,
        )
        if response.status_code not in (200, 201):
            raise SearchUnavailable(
                f"写入发布投影失败: HTTP {response.status_code} {response.text}"
            )

    async def search(self, tenant_id: str, query: str, limit: int = 20) -> list[dict[str, Any]]:
        body: dict[str, Any] = {
            "size": max(1, min(limit, 50)),
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"tenantId": tenant_id}},
                        {"term": {"status": "published"}},
                    ],
                    "must": (
                        [
                            {
                                "multi_match": {
                                    "query": query,
                                    "fields": ["title^4", "summary^2", "fullText"],
                                    "type": "best_fields",
                                }
                            }
                        ]
                        if query.strip()
                        else [{"match_all": {}}]
                    ),
                }
            },
            "highlight": {
                "fields": {"title": {}, "summary": {}, "fullText": {"fragment_size": 160}}
            },
            "sort": [{"generation": {"order": "desc"}}],
        }
        response = await self._request(
            "POST", f"/{self.settings.published_index}/_search", json=body
        )
        if response.status_code != 200:
            raise SearchUnavailable(
                f"搜索失败: HTTP {response.status_code} {response.text}"
            )
        hits = response.json().get("hits", {}).get("hits", [])
        return [
            {
                "documentId": hit["_source"].get("documentId"),
                "title": hit["_source"].get("title"),
                "summary": hit["_source"].get("summary"),
                "score": hit.get("_score"),
                "highlight": hit.get("highlight", {}),
            }
            for hit in hits
        ]
