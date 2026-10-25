from __future__ import annotations

import re
from typing import Any

from sqlalchemy import bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.compiler import Diagnostic, TemplateSource, active_field_ids
from app.models import OptionSource
from app.schemas import OptionSourceConfig
from app.utils import iso_utc

IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TABLE_RE = re.compile(r"^biz_[a-z][a-z0-9_]{0,59}$")
ZHEJIANG_CITY_SOURCE_ID = "src_zhejiang_cities"


class LookupConfigError(ValueError):
    pass


class LookupUnavailable(RuntimeError):
    pass


def _identifier(value: str, label: str) -> str:
    if not IDENTIFIER_RE.fullmatch(value):
        raise LookupConfigError(f"{label}只能使用小写字母、数字和下划线，并以小写字母开头")
    return f'"{value}"'


def _config(source: OptionSource) -> OptionSourceConfig:
    try:
        return OptionSourceConfig.model_validate(source.config)
    except ValueError as exc:
        raise LookupConfigError(f"数据源配置无效: {exc}") from exc


async def validate_source_config(session: AsyncSession, config: OptionSourceConfig) -> dict[str, Any]:
    if not TABLE_RE.fullmatch(config.tableName):
        raise LookupConfigError("业务表名必须以 biz_ 开头，并仅包含小写字母、数字和下划线")
    value_column = config.valueColumn
    label_column = config.labelColumn
    columns = [value_column, label_column, *config.searchColumns, *config.orderBy]
    if config.activeColumn:
        columns.append(config.activeColumn)
    for column in columns:
        _identifier(column, "字段名")

    table = await session.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = :table_name
            """
        ),
        {"table_name": config.tableName},
    )
    if table.scalar_one_or_none() is None:
        raise LookupConfigError(f"业务表不存在: {config.tableName}")
    result = await session.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = :table_name
            """
        ),
        {"table_name": config.tableName},
    )
    existing = {str(item) for item in result.scalars().all()}
    missing = sorted(set(columns) - existing)
    if missing:
        raise LookupConfigError(f"业务表缺少字段: {', '.join(missing)}")
    return config.model_dump()


def option_source_view(source: OptionSource) -> dict[str, Any]:
    config = _config(source)
    return {
        "id": source.id,
        "name": source.name,
        "description": source.description,
        "provider": source.provider,
        "enabled": source.enabled,
        **config.model_dump(),
        "createdAt": iso_utc(source.created_at),
        "updatedAt": iso_utc(source.updated_at),
    }


async def get_option_source(
    session: AsyncSession,
    tenant_id: str,
    source_id: str,
    *,
    require_enabled: bool = True,
) -> OptionSource:
    source = await session.get(OptionSource, source_id)
    if source is None or source.tenant_id != tenant_id:
        raise LookupConfigError("数据源不存在")
    if require_enabled and not source.enabled:
        raise LookupConfigError("数据源已停用")
    if source.provider != "postgres_table":
        raise LookupConfigError(f"不支持的数据源类型: {source.provider}")
    return source


def _where_clause(
    config: OptionSourceConfig, query: str, params: dict[str, Any]
) -> tuple[list[str], str]:
    conditions: list[str] = []
    if config.activeColumn:
        conditions.append(f'{_identifier(config.activeColumn, "启用字段")} IS TRUE')
    if query and config.searchColumns:
        search_parts = [
            f'LOWER(CAST({_identifier(column, "搜索字段")} AS TEXT)) LIKE :query'
            for column in config.searchColumns
        ]
        conditions.append(f"({' OR '.join(search_parts)})")
        params["query"] = f"%{query.lower()}%"
    order_columns = config.orderBy or [config.labelColumn, config.valueColumn]
    order_by = ", ".join(_identifier(column, "排序字段") for column in order_columns)
    return conditions, order_by


async def list_options(
    session: AsyncSession,
    source: OptionSource,
    *,
    query: str = "",
    limit: int = 50,
) -> list[dict[str, str]]:
    config = _config(source)
    params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
    conditions, order_by = _where_clause(config, query.strip()[:100], params)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = (
        f"SELECT CAST({_identifier(config.valueColumn, '值字段')} AS TEXT) AS value, "
        f"CAST({_identifier(config.labelColumn, '显示字段')} AS TEXT) AS label "
        f"FROM {_identifier(config.tableName, '业务表')} {where} "
        f"ORDER BY {order_by} LIMIT :limit"
    )
    try:
        result = await session.execute(text(sql), params)
    except Exception as exc:  # noqa: BLE001
        raise LookupUnavailable("查询数据源失败") from exc
    return [
        {"value": str(item.value), "label": str(item.label)}
        for item in result.all()
        if item.value is not None and item.label is not None
    ]


async def resolve_options(
    session: AsyncSession, source: OptionSource, values: list[str]
) -> dict[str, str]:
    unique_values = list(dict.fromkeys(value for value in values if value))
    if not unique_values:
        return {}
    config = _config(source)
    params: dict[str, Any] = {"values": unique_values}
    conditions, _ = _where_clause(config, "", params)
    value_sql = _identifier(config.valueColumn, "值字段")
    conditions.append(f"CAST({value_sql} AS TEXT) IN :values")
    sql = (
        f"SELECT CAST({value_sql} AS TEXT) AS value, "
        f"CAST({_identifier(config.labelColumn, '显示字段')} AS TEXT) AS label "
        f"FROM {_identifier(config.tableName, '业务表')} WHERE {' AND '.join(conditions)}"
    )
    statement = text(sql).bindparams(bindparam("values", expanding=True))
    try:
        result = await session.execute(statement, params)
    except Exception as exc:  # noqa: BLE001
        raise LookupUnavailable("解析数据源选项失败") from exc
    return {str(item.value): str(item.label) for item in result.all()}


async def template_source_diagnostics(
    session: AsyncSession, tenant_id: str, source_dict: dict[str, Any]
) -> list[Diagnostic]:
    source = TemplateSource.model_validate(source_dict)
    refs = {
        field.id: field.optionsSource.sourceId
        for field in source.fields
        if field.optionsSource is not None
    }
    if not refs:
        return []
    result = await session.execute(
        select(OptionSource).where(
            OptionSource.tenant_id == tenant_id,
            OptionSource.id.in_(set(refs.values())),
        )
    )
    found = {item.id: item for item in result.scalars().all()}
    diagnostics: list[Diagnostic] = []
    for field_id, source_id in refs.items():
        item = found.get(source_id)
        if item is None:
            diagnostics.append(
                Diagnostic(path=f"fields.{field_id}.optionsSource", message="数据源不存在")
            )
        elif not item.enabled:
            diagnostics.append(
                Diagnostic(path=f"fields.{field_id}.optionsSource", message="数据源已停用")
            )
    return diagnostics


async def content_lookup_diagnostics(
    session: AsyncSession, tenant_id: str, source_dict: dict[str, Any], values: dict[str, Any]
) -> list[Diagnostic]:
    source = TemplateSource.model_validate(source_dict)
    active_ids = active_field_ids(source)
    grouped: dict[str, list[tuple[str, str]]] = {}
    for field in source.fields:
        if field.id not in active_ids or field.optionsSource is None:
            continue
        value = values.get(field.id)
        if isinstance(value, str) and value:
            grouped.setdefault(field.optionsSource.sourceId, []).append((field.id, value))
    if not grouped:
        return []
    result = await session.execute(
        select(OptionSource).where(
            OptionSource.tenant_id == tenant_id,
            OptionSource.id.in_(set(grouped)),
        )
    )
    found = {item.id: item for item in result.scalars().all()}
    diagnostics: list[Diagnostic] = []
    for source_id, items in grouped.items():
        option_source = found.get(source_id)
        if option_source is None or not option_source.enabled:
            diagnostics.extend(
                Diagnostic(path=field_id, message="数据源不存在或已停用")
                for field_id, _ in items
            )
            continue
        try:
            labels = await resolve_options(
                session, option_source, [value for _, value in items]
            )
        except (LookupConfigError, LookupUnavailable) as exc:
            diagnostics.extend(
                Diagnostic(path=field_id, message=str(exc)) for field_id, _ in items
            )
            continue
        for field_id, value in items:
            if value not in labels:
                diagnostics.append(
                    Diagnostic(path=field_id, message="选项已失效或不属于该数据源")
                )
    return diagnostics
