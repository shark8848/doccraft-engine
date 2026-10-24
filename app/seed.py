from __future__ import annotations

from sqlalchemy import select

from app.compiler import compile_template
from app.config import get_settings
from app.db import SessionLocal
from app.models import Template, TemplateVersion, new_id
from app.services import DEFAULT_TEMPLATE


async def seed_examples() -> None:
    settings = get_settings()
    if settings.env not in {"dev", "test"}:
        return
    async with SessionLocal() as session:
        existing = await session.scalar(
            select(Template.id).where(Template.tenant_id == settings.default_tenant).limit(1)
        )
        if existing:
            return
        compiled = compile_template(DEFAULT_TEMPLATE)
        template = Template(
            id=new_id("tpl"),
            tenant_id=settings.default_tenant,
            name=DEFAULT_TEMPLATE["metadata"]["name"],
            description=DEFAULT_TEMPLATE["metadata"]["description"],
            draft_source=compiled["source"],
            control_version=1,
            created_by=settings.default_user,
        )
        session.add(template)
        await session.flush()
        version = TemplateVersion(
            id=new_id("tpv"),
            template_id=template.id,
            version=1,
            source=compiled["source"],
            compiled=compiled,
            template_hash=compiled["templateHash"],
            compiler_version=compiled["compilerVersion"],
            published_by=settings.default_user,
        )
        session.add(version)
        await session.flush()
        template.published_version_id = version.id
        await session.commit()
