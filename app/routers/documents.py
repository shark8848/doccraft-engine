from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.compiler import validate_content
from app.db import get_session
from app.deps import Identity, get_identity, parse_etag, require_publisher
from app.es import SearchUnavailable
from app.models import (
    Asset,
    Document,
    Operation,
    OutboxEvent,
    Publication,
    Revision,
    Template,
    TemplateVersion,
    new_id,
)
from app.schemas import DocumentCreateRequest, DocumentDraftRequest
from app.utils import error_detail, iso_utc, sha256_json

router = APIRouter(prefix="/documents", tags=["documents"])


def document_view(
    document: Document,
    template: Template | None = None,
    *,
    content: dict[str, Any] | None = None,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": document.id,
        "title": document.title,
        "status": document.status,
        "templateId": document.template_id,
        "templateVersionId": document.template_version_id,
        "templateName": template.name if template else "",
        "draftRevisionId": document.draft_revision_id,
        "publishedRevisionId": document.published_revision_id,
        "controlVersion": document.control_version,
        "draftGeneration": document.draft_generation,
        "publicationGeneration": document.publication_generation,
        "createdAt": iso_utc(document.created_at),
        "updatedAt": iso_utc(document.updated_at),
        "content": content,
        "templateSource": source,
    }


@router.get("")
async def list_documents(
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(Document, Template)
        .join(Template, Template.id == Document.template_id)
        .where(Document.tenant_id == identity.tenant_id)
        .order_by(Document.updated_at.desc())
    )
    return {
        "items": [document_view(document, template) for document, template in result.all()]
    }


@router.post("", status_code=201)
async def create_document(
    payload: DocumentCreateRequest,
    response: Response,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    template = await session.get(Template, payload.templateId)
    if template is None or template.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "模板不存在"})
    version = (
        await session.get(TemplateVersion, template.published_version_id)
        if template.published_version_id
        else None
    )
    if version is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "TEMPLATE_NOT_PUBLISHED", "message": "请先发布模板"},
        )
    document = Document(
        id=new_id("doc"),
        tenant_id=identity.tenant_id,
        template_id=template.id,
        template_version_id=version.id,
        title=payload.title.strip(),
        status="draft",
        control_version=1,
        created_by=identity.user_id,
    )
    session.add(document)
    await session.commit()
    response.headers["ETag"] = '"1"'
    return document_view(document, template, source=version.source)


@router.get("/{document_id}")
async def get_document(
    document_id: str,
    request: Request,
    response: Response,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    document, template = await _load_document(session, document_id, identity)
    version = await session.get(TemplateVersion, document.template_version_id)
    if version is None:
        raise HTTPException(
            status_code=500,
            detail={"code": "TEMPLATE_VERSION_MISSING", "message": "文档绑定的模板版本不存在"},
        )
    content = None
    if document.draft_revision_id:
        try:
            content = await request.app.state.es.get_revision(document.draft_revision_id)
        except SearchUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "BODY_UNAVAILABLE", "message": str(exc)},
            ) from exc
    response.headers["ETag"] = f'"{document.control_version}"'
    return document_view(
        document,
        template,
        content=(content or {}).get("values") if content else None,
        source=version.source,
    )


@router.put("/{document_id}/draft")
async def save_document_draft(
    document_id: str,
    payload: DocumentDraftRequest,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    expected = parse_etag(if_match)
    if expected is None:
        raise HTTPException(
            status_code=428,
            detail={"code": "PRECONDITION_REQUIRED", "message": "缺少 If-Match"},
        )
    if not idempotency_key:
        raise HTTPException(
            status_code=428,
            detail={"code": "IDEMPOTENCY_REQUIRED", "message": "缺少 Idempotency-Key"},
        )

    request_hash = sha256_json({"documentId": document_id, "values": payload.values})
    existing = await session.scalar(
        select(Operation).where(
            Operation.tenant_id == identity.tenant_id,
            Operation.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise HTTPException(
                status_code=409,
                detail=error_detail("IDEMPOTENCY_CONFLICT", "同一幂等键对应了不同请求"),
            )
        if existing.response is not None:
            response.headers["ETag"] = f'"{existing.response.get("controlVersion")}"'
            return existing.response

    result = await session.execute(
        select(Document)
        .where(
            Document.id == document_id,
            Document.tenant_id == identity.tenant_id,
        )
        .with_for_update()
    )
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "文档不存在"})
    if document.control_version != expected:
        raise HTTPException(
            status_code=412,
            detail=error_detail(
                "VERSION_CONFLICT",
                "文档已被其他会话更新",
                currentVersion=document.control_version,
            ),
        )

    version = await session.get(TemplateVersion, document.template_version_id)
    if version is None:
        raise HTTPException(
            status_code=500,
            detail={"code": "TEMPLATE_VERSION_MISSING", "message": "文档绑定的模板版本不存在"},
        )
    diagnostics = validate_content(version.source, payload.values, "draft")
    if diagnostics:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CONTENT_INVALID",
                "message": "内容校验失败",
                "diagnostics": [item.model_dump() for item in diagnostics],
            },
        )
    await _validate_assets(session, identity.tenant_id, payload.values)

    revision_id = new_id("rev")
    revision_no = document.draft_generation + 1
    content_hash = sha256_json(payload.values)
    operation_id = new_id("op")
    revision_doc = {
        "documentId": document.id,
        "tenantId": identity.tenant_id,
        "revisionId": revision_id,
        "revisionNo": revision_no,
        "templateVersionId": version.id,
        "contentHash": content_hash,
        "operationId": operation_id,
        "values": payload.values,
        "status": "draft",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await request.app.state.es.put_revision(revision_id, revision_doc)
    except SearchUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "BODY_STORE_UNAVAILABLE", "message": str(exc)},
        ) from exc

    title_field = version.source.get("indexing", {}).get("titleField", "")
    if title_field and payload.values.get(title_field):
        document.title = str(payload.values[title_field])[:300]
    document.draft_revision_id = revision_id
    document.draft_generation = revision_no
    document.control_version += 1
    session.add(
        Revision(
            id=revision_id,
            document_id=document.id,
            revision_no=revision_no,
            template_version_id=version.id,
            content_hash=content_hash,
            es_index=request.app.state.settings.revision_index,
            created_by=identity.user_id,
        )
    )
    response_payload = document_view(
        document,
        await session.get(Template, document.template_id),
        content=payload.values,
        source=version.source,
    ) | {"revisionId": revision_id, "contentHash": content_hash}
    operation = existing or Operation(
        id=operation_id,
        tenant_id=identity.tenant_id,
        idempotency_key=idempotency_key,
        operation="document.save",
        request_hash=request_hash,
    )
    operation.status = "COMMITTED"
    operation.response = response_payload
    session.add(operation)
    await session.commit()
    response.headers["ETag"] = f'"{document.control_version}"'
    return response_payload


@router.post("/{document_id}/publish")
async def publish_document(
    document_id: str,
    request: Request,
    response: Response,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    require_publisher(identity)
    result = await session.execute(
        select(Document)
        .where(Document.id == document_id, Document.tenant_id == identity.tenant_id)
        .with_for_update()
    )
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "文档不存在"})
    if not document.draft_revision_id:
        raise HTTPException(
            status_code=409,
            detail={"code": "EMPTY_DRAFT", "message": "请先保存草稿"},
        )
    revision = await session.get(Revision, document.draft_revision_id)
    version = await session.get(TemplateVersion, document.template_version_id)
    if revision is None or version is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "REVISION_MISSING", "message": "草稿版本元数据不完整"},
        )
    try:
        revision_doc = await request.app.state.es.get_revision(revision.id)
    except SearchUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "BODY_STORE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    if revision_doc is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "BODY_MISSING", "message": "草稿正文在 ES 中不存在"},
        )
    diagnostics = validate_content(version.source, revision_doc.get("values", {}), "publish")
    if diagnostics:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CONTENT_INVALID",
                "message": "内容不满足发布要求",
                "diagnostics": [item.model_dump() for item in diagnostics],
            },
        )
    await _validate_assets(session, identity.tenant_id, revision_doc.get("values", {}))
    generation = document.publication_generation + 1
    publication = Publication(
        id=new_id("pub"),
        document_id=document.id,
        revision_id=revision.id,
        generation=generation,
        published_by=identity.user_id,
    )
    document.status = "published"
    document.published_revision_id = revision.id
    document.publication_generation = generation
    document.control_version += 1
    session.add(publication)
    session.add(
        OutboxEvent(
            id=new_id("evt"),
            tenant_id=identity.tenant_id,
            event_type="publish.index",
            aggregate_id=document.id,
            payload={
                "documentId": document.id,
                "revisionId": revision.id,
                "generation": generation,
                "publishedBy": identity.user_id,
            },
        )
    )
    await session.commit()
    response.headers["ETag"] = f'"{document.control_version}"'
    return {
        "documentId": document.id,
        "revisionId": revision.id,
        "generation": generation,
        "status": "published",
        "controlVersion": document.control_version,
    }


@router.get("/{document_id}/published")
async def get_published_document(
    document_id: str,
    request: Request,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    document, template = await _load_document(session, document_id, identity)
    if not document.published_revision_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_PUBLISHED", "message": "文档尚未发布"})
    try:
        revision_doc = await request.app.state.es.get_revision(document.published_revision_id)
    except SearchUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "BODY_STORE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    if revision_doc is None:
        raise HTTPException(status_code=404, detail={"code": "BODY_MISSING", "message": "发布正文不存在"})
    version = await session.get(TemplateVersion, document.template_version_id)
    return document_view(
        document,
        template,
        content=revision_doc.get("values"),
        source=version.source if version else None,
    )


async def _load_document(
    session: AsyncSession, document_id: str, identity: Identity
) -> tuple[Document, Template]:
    document = await session.get(Document, document_id)
    if document is None or document.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "文档不存在"})
    template = await session.get(Template, document.template_id)
    if template is None:
        raise HTTPException(status_code=500, detail={"code": "TEMPLATE_MISSING", "message": "模板不存在"})
    return document, template


ASSET_ID_RE = re.compile(r"asset_[a-f0-9]{32}")


def _collect_asset_ids(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, str):
        if ASSET_ID_RE.fullmatch(value):
            found.add(value)
    elif isinstance(value, list):
        for item in value:
            found.update(_collect_asset_ids(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in {"assetId", "asset_id"} and isinstance(item, str):
                found.add(item)
            else:
                found.update(_collect_asset_ids(item))
    return found


async def _validate_assets(session: AsyncSession, tenant_id: str, values: dict[str, Any]) -> None:
    asset_ids = _collect_asset_ids(values)
    if not asset_ids:
        return
    result = await session.execute(
        select(Asset.id, Asset.status).where(
            Asset.tenant_id == tenant_id, Asset.id.in_(asset_ids)
        )
    )
    found = dict(result.all())
    missing = sorted(asset_ids - found.keys())
    if missing:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ASSET_NOT_FOUND",
                "message": "内容引用了不存在或无权访问的资产",
                "assetIds": missing,
            },
        )
    unavailable = sorted(asset_id for asset_id, status in found.items() if status != "READY")
    if unavailable:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ASSET_NOT_READY",
                "message": "资产仍在处理中或未通过校验",
                "assetIds": unavailable,
            },
        )
