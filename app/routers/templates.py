from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.compiler import (
    TemplateCompileError,
    compile_template,
    export_yaml_template,
    parse_yaml_template,
)
from app.db import get_session
from app.deps import Identity, get_identity, parse_etag, require_publisher
from app.lookups import template_source_diagnostics
from app.models import Template, TemplateVersion, new_id
from app.schemas import (
    TemplateCreateRequest,
    TemplateDraftRequest,
    TemplateImportRequest,
    TemplateValidateRequest,
)
from app.services import compile_or_422, get_template_version, template_summary
from app.utils import iso_utc

router = APIRouter(prefix="/templates", tags=["templates"])


async def ensure_option_sources(
    session: AsyncSession, tenant_id: str, source: dict
) -> None:
    diagnostics = await template_source_diagnostics(session, tenant_id, source)
    if diagnostics:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "TEMPLATE_INVALID",
                "message": "模板引用的数据源不可用",
                "diagnostics": [item.model_dump() for item in diagnostics],
            },
        )


@router.get("")
async def list_templates(
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(Template)
        .where(Template.tenant_id == identity.tenant_id)
        .order_by(Template.updated_at.desc())
    )
    return {"items": [template_summary(item) for item in result.scalars().all()]}


@router.post("", status_code=201)
async def create_template(
    payload: TemplateCreateRequest,
    response: Response,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    compiled = compile_or_422(payload.source)
    await ensure_option_sources(session, identity.tenant_id, compiled["source"])
    template = Template(
        id=new_id("tpl"),
        tenant_id=identity.tenant_id,
        name=compiled["source"]["metadata"]["name"],
        description=compiled["source"]["metadata"].get("description", ""),
        draft_source=compiled["source"],
        control_version=1,
        created_by=identity.user_id,
    )
    session.add(template)
    await session.commit()
    response.headers["ETag"] = '"1"'
    return {
        **template_summary(template),
        "source": compiled["source"],
        "compiled": compiled,
    }


@router.get("/{template_id}")
async def get_template(
    template_id: str,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    template = await session.get(Template, template_id)
    if template is None or template.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "模板不存在"})
    compiled = compile_template(template.draft_source)
    published = (
        await session.get(TemplateVersion, template.published_version_id)
        if template.published_version_id
        else None
    )
    return {
        **template_summary(template),
        "source": template.draft_source,
        "compiled": compiled,
        "publishedVersion": (
            {
                "id": published.id,
                "version": published.version,
                "templateHash": published.template_hash,
                "publishedAt": iso_utc(published.published_at),
            }
            if published
            else None
        ),
    }


@router.put("/{template_id}/draft")
async def save_template_draft(
    template_id: str,
    payload: TemplateDraftRequest,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    expected = parse_etag(if_match)
    if expected is None:
        raise HTTPException(
            status_code=428,
            detail={"code": "PRECONDITION_REQUIRED", "message": "缺少 If-Match"},
        )
    template = await session.get(Template, template_id)
    if template is None or template.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "模板不存在"})
    if template.control_version != expected:
        raise HTTPException(
            status_code=412,
            detail={
                "code": "VERSION_CONFLICT",
                "message": "模板已被其他编辑更新",
                "currentVersion": template.control_version,
            },
        )
    compiled = compile_or_422(payload.source)
    await ensure_option_sources(session, identity.tenant_id, compiled["source"])
    template.draft_source = compiled["source"]
    template.name = compiled["source"]["metadata"]["name"]
    template.description = compiled["source"]["metadata"].get("description", "")
    template.control_version += 1
    await session.commit()
    response.headers["ETag"] = f'"{template.control_version}"'
    return {
        **template_summary(template),
        "source": template.draft_source,
        "compiled": compiled,
    }


@router.post("/{template_id}/validate")
async def validate_template(
    template_id: str,
    payload: TemplateValidateRequest,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    template = await session.get(Template, template_id)
    if template is None or template.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "模板不存在"})
    compiled = compile_or_422(payload.source)
    await ensure_option_sources(session, identity.tenant_id, compiled["source"])
    return {"valid": True, "compiled": compiled}


@router.post("/{template_id}/publish")
async def publish_template(
    template_id: str,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    require_publisher(identity)
    template = await session.get(Template, template_id)
    if template is None or template.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "模板不存在"})
    compiled = compile_or_422(template.draft_source)
    await ensure_option_sources(session, identity.tenant_id, compiled["source"])
    count = await session.scalar(
        select(func.count(TemplateVersion.id)).where(TemplateVersion.template_id == template_id)
    )
    version = TemplateVersion(
        id=new_id("tpv"),
        template_id=template_id,
        version=int(count or 0) + 1,
        source=compiled["source"],
        compiled=compiled,
        template_hash=compiled["templateHash"],
        compiler_version=compiled["compilerVersion"],
        published_by=identity.user_id,
    )
    session.add(version)
    await session.flush()
    template.published_version_id = version.id
    await session.commit()
    return {
        "templateId": template_id,
        "versionId": version.id,
        "version": version.version,
        "templateHash": version.template_hash,
        "publishedAt": iso_utc(version.published_at),
    }


@router.get("/{template_id}/export.yaml")
async def export_template_yaml(
    template_id: str,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> Response:
    template = await session.get(Template, template_id)
    if template is None or template.tenant_id != identity.tenant_id:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "模板不存在"})
    body = export_yaml_template(template.draft_source)
    return Response(
        content=body,
        media_type="application/yaml",
        headers={"Content-Disposition": f'attachment; filename="{template_id}.yaml"'},
    )


@router.post("/import/yaml")
async def import_template_yaml(
    payload: TemplateImportRequest,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        source = parse_yaml_template(payload.yaml)
    except TemplateCompileError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "TEMPLATE_INVALID",
                "message": "YAML 模板校验失败",
                "diagnostics": [item.model_dump() for item in exc.diagnostics],
            },
        ) from exc
    compiled = compile_or_422(source)
    await ensure_option_sources(session, identity.tenant_id, compiled["source"])
    return {"source": source, "compiled": compiled}
