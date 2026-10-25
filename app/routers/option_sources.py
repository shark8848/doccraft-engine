from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import Identity, get_identity, require_publisher
from app.lookups import (
    LookupConfigError,
    LookupUnavailable,
    get_option_source,
    list_options,
    option_source_view,
    resolve_options,
    validate_source_config,
)
from app.models import OptionSource, new_id
from app.schemas import OptionResolveRequest, OptionSourceConfig, OptionSourceRequest

router = APIRouter(prefix="/option-sources", tags=["option-sources"])


@router.get("")
async def list_option_sources(
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(OptionSource)
        .where(OptionSource.tenant_id == identity.tenant_id)
        .order_by(OptionSource.name)
    )
    return {"items": [option_source_view(item) for item in result.scalars().all()]}


@router.post("", status_code=201)
async def create_option_source(
    payload: OptionSourceRequest,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    require_publisher(identity)
    duplicate = await session.scalar(
        select(OptionSource.id).where(
            OptionSource.tenant_id == identity.tenant_id,
            OptionSource.name == payload.name.strip(),
        )
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail={"code": "OPTION_SOURCE_EXISTS", "message": "数据源名称已存在"},
        )
    try:
        config = await validate_source_config(
            session,
            OptionSourceConfig(
                tableName=payload.tableName,
                valueColumn=payload.valueColumn,
                labelColumn=payload.labelColumn,
                searchColumns=payload.searchColumns,
                activeColumn=payload.activeColumn,
                orderBy=payload.orderBy,
            ),
        )
    except LookupConfigError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "OPTION_SOURCE_INVALID", "message": str(exc)},
        ) from exc
    source = OptionSource(
        id=new_id("src"),
        tenant_id=identity.tenant_id,
        name=payload.name.strip(),
        description=payload.description.strip(),
        provider="postgres_table",
        config=config,
        enabled=payload.enabled,
        created_by=identity.user_id,
    )
    session.add(source)
    await session.commit()
    return option_source_view(source)


@router.put("/{source_id}")
async def update_option_source(
    source_id: str,
    payload: OptionSourceRequest,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    require_publisher(identity)
    source = await session.get(OptionSource, source_id)
    if source is None or source.tenant_id != identity.tenant_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "NOT_FOUND", "message": "数据源不存在"},
        )
    duplicate = await session.scalar(
        select(OptionSource.id).where(
            OptionSource.tenant_id == identity.tenant_id,
            OptionSource.name == payload.name.strip(),
            OptionSource.id != source_id,
        )
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail={"code": "OPTION_SOURCE_EXISTS", "message": "数据源名称已存在"},
        )
    try:
        config = await validate_source_config(
            session,
            OptionSourceConfig(
                tableName=payload.tableName,
                valueColumn=payload.valueColumn,
                labelColumn=payload.labelColumn,
                searchColumns=payload.searchColumns,
                activeColumn=payload.activeColumn,
                orderBy=payload.orderBy,
            ),
        )
    except LookupConfigError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "OPTION_SOURCE_INVALID", "message": str(exc)},
        ) from exc
    source.name = payload.name.strip()
    source.description = payload.description.strip()
    source.config = config
    source.enabled = payload.enabled
    await session.commit()
    return option_source_view(source)


@router.get("/{source_id}/options")
async def get_source_options(
    source_id: str,
    query: str = Query(default="", max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        source = await get_option_source(session, identity.tenant_id, source_id)
        items = await list_options(session, source, query=query, limit=limit)
    except LookupConfigError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "OPTION_SOURCE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    except LookupUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "OPTION_SOURCE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    return {"items": items}


@router.post("/{source_id}/resolve")
async def resolve_source_options(
    source_id: str,
    payload: OptionResolveRequest,
    identity: Identity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        source = await get_option_source(session, identity.tenant_id, source_id)
        labels = await resolve_options(session, source, payload.values)
    except LookupConfigError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "OPTION_SOURCE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    except LookupUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "OPTION_SOURCE_UNAVAILABLE", "message": str(exc)},
        ) from exc
    return {
        "items": [{"value": value, "label": label} for value, label in labels.items()],
        "missing": [value for value in dict.fromkeys(payload.values) if value not in labels],
    }
