from __future__ import annotations

from sqlalchemy import select

from app.compiler import compile_template
from app.config import get_settings
from app.db import SessionLocal
from app.lookups import ZHEJIANG_CITY_SOURCE_ID
from app.models import OptionSource, RegionCity, Template, TemplateVersion, new_id
from app.services import DEFAULT_TEMPLATE

ZHEJIANG_CITIES = (
    ("330100", "杭州市", 10),
    ("330200", "宁波市", 20),
    ("330300", "温州市", 30),
    ("330400", "嘉兴市", 40),
    ("330500", "湖州市", 50),
    ("330600", "绍兴市", 60),
    ("330700", "金华市", 70),
    ("330800", "衢州市", 80),
    ("330900", "舟山市", 90),
    ("331000", "台州市", 100),
    ("331100", "丽水市", 110),
)


async def seed_region_cities(session) -> None:
    for city_code, city_name, sort_order in ZHEJIANG_CITIES:
        if await session.get(RegionCity, city_code) is None:
            session.add(
                RegionCity(
                    city_code=city_code,
                    city_name=city_name,
                    province_code="330000",
                    province_name="浙江省",
                    enabled=True,
                    sort_order=sort_order,
                )
            )


async def seed_option_sources(session, tenant_id: str, created_by: str) -> None:
    if await session.get(OptionSource, ZHEJIANG_CITY_SOURCE_ID) is None:
        session.add(
            OptionSource(
                id=ZHEJIANG_CITY_SOURCE_ID,
                tenant_id=tenant_id,
                name="浙江省地市",
                description="从 biz_region_city 业务表动态读取浙江省地市代码和名称",
                provider="postgres_table",
                config={
                    "tableName": "biz_region_city",
                    "valueColumn": "city_code",
                    "labelColumn": "city_name",
                    "searchColumns": ["city_name", "city_code"],
                    "activeColumn": "enabled",
                    "orderBy": ["sort_order", "city_code"],
                },
                enabled=True,
                created_by=created_by,
            )
        )


async def seed_examples() -> None:
    settings = get_settings()
    if settings.env not in {"dev", "test"}:
        return
    async with SessionLocal() as session:
        await seed_region_cities(session)
        await seed_option_sources(session, settings.default_tenant, settings.default_user)
        existing = await session.scalar(
            select(Template.id).where(Template.tenant_id == settings.default_tenant).limit(1)
        )
        if existing:
            await session.commit()
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
