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


class OptionSourceConfig(BaseModel):
    tableName: str = Field(min_length=1, max_length=64)
    valueColumn: str = Field(min_length=1, max_length=64)
    labelColumn: str = Field(min_length=1, max_length=64)
    searchColumns: list[str] = Field(default_factory=list, max_length=8)
    activeColumn: str = Field(default="", max_length=64)
    orderBy: list[str] = Field(default_factory=list, max_length=8)


class OptionSourceRequest(OptionSourceConfig):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)
    enabled: bool = True


class OptionResolveRequest(BaseModel):
    values: list[str] = Field(default_factory=list, max_length=200)
