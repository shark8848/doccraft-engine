from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


class Base(DeclarativeBase):
    pass


JSONType = JSON().with_variant(JSONB, "postgresql")


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    draft_source: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    control_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_version_id: Mapped[str | None] = mapped_column(String(80))
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class TemplateVersion(Base):
    __tablename__ = "template_versions"
    __table_args__ = (
        UniqueConstraint("template_id", "version", name="uq_template_version"),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    template_id: Mapped[str] = mapped_column(
        ForeignKey("templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    compiled: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    template_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    compiler_version: Mapped[str] = mapped_column(String(32), nullable=False)
    published_by: Mapped[str] = mapped_column(String(80), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    template_id: Mapped[str] = mapped_column(
        ForeignKey("templates.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    template_version_id: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    draft_revision_id: Mapped[str | None] = mapped_column(String(80))
    published_revision_id: Mapped[str | None] = mapped_column(String(80))
    draft_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    publication_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    control_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class Revision(Base):
    __tablename__ = "revisions"
    __table_args__ = (
        UniqueConstraint("document_id", "revision_no", name="uq_document_revision_no"),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    template_version_id: Mapped[str] = mapped_column(String(80), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    es_index: Mapped[str] = mapped_column(String(200), nullable=False)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Publication(Base):
    __tablename__ = "publications"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_id: Mapped[str] = mapped_column(String(80), nullable=False)
    generation: Mapped[int] = mapped_column(Integer, nullable=False)
    published_by: Mapped[str] = mapped_column(String(80), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    bucket: Mapped[str] = mapped_column(String(200), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    pyuploadx_file_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(200), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="SCANNING")
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
    error_message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_assets_tenant_status", "tenant_id", "status"),)


class RegionCity(Base):
    __tablename__ = "biz_region_city"

    city_code: Mapped[str] = mapped_column(String(12), primary_key=True)
    city_name: Mapped[str] = mapped_column(String(80), nullable=False)
    province_code: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    province_name: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class OptionSource(Base):
    __tablename__ = "option_sources"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_option_source_name"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="postgres_table")
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class Operation(Base):
    __tablename__ = "operations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_operation_key"),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    operation: Mapped[str] = mapped_column(String(80), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING")
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(80), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )

    __table_args__ = (Index("ix_outbox_status_created", "status", "created_at"),)
