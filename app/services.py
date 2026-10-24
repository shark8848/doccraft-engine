from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.compiler import TemplateCompileError, compile_template
from app.models import Template, TemplateVersion
from app.utils import iso_utc


def template_summary(template: Template) -> dict[str, Any]:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "controlVersion": template.control_version,
        "publishedVersionId": template.published_version_id,
        "status": "published" if template.published_version_id else "draft",
        "updatedAt": iso_utc(template.updated_at),
        "createdAt": iso_utc(template.created_at),
    }


async def get_template_version(
    session: AsyncSession, version_id: str | None, template_id: str
) -> TemplateVersion | None:
    if version_id:
        version = await session.get(TemplateVersion, version_id)
        if version is not None:
            return version
    result = await session.execute(
        select(TemplateVersion)
        .where(TemplateVersion.template_id == template_id)
        .order_by(TemplateVersion.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def compile_or_422(source: dict[str, Any]) -> dict[str, Any]:
    from fastapi import HTTPException

    try:
        return compile_template(source)
    except TemplateCompileError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "TEMPLATE_INVALID",
                "message": "模板校验失败",
                "diagnostics": [item.model_dump() for item in exc.diagnostics],
            },
        ) from exc


DEFAULT_TEMPLATE: dict[str, Any] = {
    "schemaVersion": 1,
    "metadata": {
        "name": "产品知识文档",
        "description": "适用于产品说明、FAQ 和操作规程的示例模板",
    },
    "fields": [
        {
            "id": "title",
            "type": "string",
            "label": "标题",
            "placeholder": "输入文档标题",
            "help": "",
            "requiredAt": ["submit", "publish"],
            "options": [],
        },
        {
            "id": "summary",
            "type": "text",
            "label": "摘要",
            "placeholder": "用一两句话概括文档",
            "help": "",
            "requiredAt": ["submit", "publish"],
            "options": [],
        },
        {
            "id": "body",
            "type": "richtext",
            "label": "正文",
            "placeholder": "",
            "help": "支持段落、列表、标题、链接与图片",
            "requiredAt": ["submit", "publish"],
            "options": [],
        },
    ],
    "layout": {
        "id": "root",
        "kind": "stack",
        "title": "",
        "fieldId": None,
        "text": "",
        "children": [
            {
                "id": "sec_main",
                "kind": "section",
                "title": "文档内容",
                "fieldId": None,
                "text": "",
                "children": [
                    {
                        "id": "slot_title",
                        "kind": "field",
                        "title": "",
                        "fieldId": "title",
                        "text": "",
                        "children": [],
                    },
                    {
                        "id": "slot_summary",
                        "kind": "field",
                        "title": "",
                        "fieldId": "summary",
                        "text": "",
                        "children": [],
                    },
                    {
                        "id": "slot_body",
                        "kind": "richText",
                        "title": "",
                        "fieldId": "body",
                        "text": "",
                        "children": [],
                    },
                ],
            }
        ],
    },
    "workflow": {"singleReview": True},
    "indexing": {"titleField": "title", "summaryField": "summary", "fullTextField": "body"},
}
