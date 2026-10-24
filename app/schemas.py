from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TemplateCreateRequest(BaseModel):
    source: dict[str, Any]


class TemplateDraftRequest(BaseModel):
    source: dict[str, Any]


class TemplateValidateRequest(BaseModel):
    source: dict[str, Any]


class TemplateImportRequest(BaseModel):
    yaml: str = Field(min_length=1)


class DocumentCreateRequest(BaseModel):
    templateId: str
    title: str = Field(min_length=1, max_length=300)


class DocumentDraftRequest(BaseModel):
    values: dict[str, Any]


class DocumentPublishRequest(BaseModel):
    pass
