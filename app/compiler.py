from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

COMPILER_VERSION = "1.0"
STAGES = ("draft", "submit", "publish")
FIELD_TYPES = {
    "string",
    "text",
    "enum",
    "array",
    "object",
    "number",
    "boolean",
    "date",
    "asset",
    "richtext",
}
BLOCK_KINDS = {"stack", "section", "columns", "field", "richText", "asset", "staticText"}
ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,63}$")


class Diagnostic(BaseModel):
    path: str
    message: str


class TemplateCompileError(ValueError):
    def __init__(self, diagnostics: list[Diagnostic]):
        self.diagnostics = diagnostics
        super().__init__("; ".join(f"{item.path}: {item.message}" for item in diagnostics))


class FieldOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    value: str


class TemplateField(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    type: Literal[
        "string", "text", "enum", "array", "object", "number", "boolean", "date", "asset", "richtext"
    ]
    label: str = Field(min_length=1, max_length=200)
    placeholder: str = ""
    help: str = ""
    requiredAt: list[Literal["draft", "submit", "publish"]] = Field(default_factory=list)
    options: list[FieldOption] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not ID_RE.fullmatch(value):
            raise ValueError("只能使用小写字母开头的字母、数字和下划线，长度 2-64")
        return value

    @model_validator(mode="after")
    def validate_options(self) -> "TemplateField":
        if self.type == "enum" and not self.options:
            raise ValueError("enum 字段必须提供 options")
        if self.type != "enum" and self.options:
            raise ValueError("只有 enum 字段可以配置 options")
        return self


class LayoutBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["stack", "section", "columns", "field", "richText", "asset", "staticText"]
    title: str = ""
    fieldId: str | None = None
    text: str = ""
    children: list["LayoutBlock"] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        if not ID_RE.fullmatch(value):
            raise ValueError("block id 只能使用小写字母开头的字母、数字和下划线，长度 2-64")
        return value


class TemplateMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class Workflow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    singleReview: bool = True


class Indexing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    titleField: str
    summaryField: str = ""
    fullTextField: str = ""


class TemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal[1] = 1
    metadata: TemplateMetadata
    fields: list[TemplateField] = Field(min_length=1, max_length=200)
    layout: LayoutBlock
    workflow: Workflow = Field(default_factory=Workflow)
    indexing: Indexing

    @model_validator(mode="after")
    def validate_template(self) -> "TemplateSource":
        diagnostics: list[Diagnostic] = []
        if self.layout.kind != "stack":
            diagnostics.append(Diagnostic(path="layout", message="根布局必须是 stack"))

        field_ids: set[str] = set()
        for index, field in enumerate(self.fields):
            if field.id in field_ids:
                diagnostics.append(
                    Diagnostic(path=f"fields[{index}].id", message=f"字段 ID 重复: {field.id}")
                )
            field_ids.add(field.id)

        block_ids: set[str] = set()
        field_refs: list[tuple[str, str, str]] = []

        def walk(block: LayoutBlock, path: str, depth: int, parent: str | None) -> None:
            if depth > 6:
                diagnostics.append(Diagnostic(path=path, message="布局嵌套不能超过 6 层"))
                return
            if block.id in block_ids:
                diagnostics.append(Diagnostic(path=f"{path}.id", message=f"block ID 重复: {block.id}"))
            block_ids.add(block.id)

            allowed_parents = {
                "stack": {"stack", "section", "columns"},
                "section": {"stack", "columns"},
                "columns": {"stack", "section"},
                "field": {"stack", "section", "columns"},
                "richText": {"stack", "section", "columns"},
                "asset": {"stack", "section", "columns"},
                "staticText": {"stack", "section", "columns"},
            }
            if parent is not None and parent not in allowed_parents[block.kind]:
                diagnostics.append(
                    Diagnostic(path=path, message=f"{block.kind} 不能放在 {parent} 中")
                )

            if block.kind in {"field", "richText", "asset"}:
                if not block.fieldId:
                    diagnostics.append(Diagnostic(path=f"{path}.fieldId", message="必须引用字段"))
                else:
                    field_refs.append((path, block.kind, block.fieldId))
                if block.children:
                    diagnostics.append(Diagnostic(path=f"{path}.children", message="该区块不能嵌套子区块"))
            elif block.kind in {"stack", "section", "columns"} and not block.children:
                diagnostics.append(Diagnostic(path=f"{path}.children", message="容器至少需要一个子区块"))
            elif block.kind == "staticText" and not block.text.strip():
                diagnostics.append(Diagnostic(path=f"{path}.text", message="静态文本不能为空"))

            for child_index, child in enumerate(block.children):
                walk(child, f"{path}.children[{child_index}]", depth + 1, block.kind)

        walk(self.layout, "layout", 0, None)
        for path, block_kind, field_id in field_refs:
            field = next((item for item in self.fields if item.id == field_id), None)
            if field is None:
                diagnostics.append(Diagnostic(path=f"{path}.fieldId", message=f"字段不存在: {field_id}"))
                continue
            expected = {"field": None, "richText": "richtext", "asset": "asset"}[block_kind]
            if expected is not None and field.type != expected:
                diagnostics.append(
                    Diagnostic(
                        path=f"{path}.fieldId",
                        message=f"{block_kind} 必须引用 {expected} 字段，实际为 {field.type}",
                    )
                )
            if block_kind == "field" and field.type in {"richtext", "asset"}:
                diagnostics.append(
                    Diagnostic(
                        path=f"{path}.fieldId",
                        message=f"{field.type} 字段必须使用 {field.type} 区块",
                    )
                )

        if self.indexing.titleField not in field_ids:
            diagnostics.append(
                Diagnostic(path="indexing.titleField", message="标题字段不存在")
            )
        if self.indexing.summaryField and self.indexing.summaryField not in field_ids:
            diagnostics.append(
                Diagnostic(path="indexing.summaryField", message="摘要字段不存在")
            )
        if self.indexing.fullTextField and self.indexing.fullTextField not in field_ids:
            diagnostics.append(
                Diagnostic(path="indexing.fullTextField", message="正文字段不存在")
            )

        if diagnostics:
            raise TemplateCompileError(diagnostics)
        return self


def _active_field_ids(source: TemplateSource) -> set[str]:
    active: set[str] = set()

    def walk(block: LayoutBlock) -> None:
        if block.fieldId:
            active.add(block.fieldId)
        for child in block.children:
            walk(child)

    walk(source.layout)
    active.update(
        field_id
        for field_id in (
            source.indexing.titleField,
            source.indexing.summaryField,
            source.indexing.fullTextField,
        )
        if field_id
    )
    return active


def _json_type(field: TemplateField) -> dict[str, Any]:
    if field.type in {"string", "text"}:
        schema: dict[str, Any] = {"type": "string", "maxLength": 100_000}
        if field.type == "text":
            schema["x-ui"] = "textarea"
        return schema
    if field.type == "enum":
        return {"type": "string", "enum": [item.value for item in field.options]}
    if field.type == "array":
        return {"type": "array", "items": {"type": "string"}, "maxItems": 200}
    if field.type == "object":
        return {"type": "object", "additionalProperties": True}
    if field.type == "number":
        return {"type": "number"}
    if field.type == "boolean":
        return {"type": "boolean"}
    if field.type == "date":
        return {"type": "string", "format": "date"}
    if field.type == "asset":
        return {"type": "string", "pattern": "^asset_[a-f0-9]{32}$"}
    if field.type == "richtext":
        return {"type": "object", "x-ui": "richtext"}
    return {"type": "string"}


def _block_index(block: LayoutBlock, fields: dict[str, TemplateField]) -> dict[str, Any]:
    result: dict[str, Any] = {"id": block.id, "kind": block.kind}
    if block.kind == "section":
        result["title"] = block.title
    if block.kind == "staticText":
        result["text"] = block.text
    if block.fieldId and block.fieldId in fields:
        field = fields[block.fieldId]
        result["field"] = {
            "id": field.id,
            "type": field.type,
            "label": field.label,
            "placeholder": field.placeholder,
            "help": field.help,
            "requiredAt": field.requiredAt,
            "options": [item.model_dump() for item in field.options],
        }
    if block.children:
        result["children"] = [_block_index(child, fields) for child in block.children]
    return result


def compile_template(source_dict: dict[str, Any]) -> dict[str, Any]:
    try:
        source = TemplateSource.model_validate(source_dict)
    except ValidationError as exc:
        diagnostics = [
            Diagnostic(path=".".join(str(part) for part in error["loc"]), message=error["msg"])
            for error in exc.errors()
        ]
        raise TemplateCompileError(diagnostics) from exc

    active_ids = _active_field_ids(source)
    active_fields = [field for field in source.fields if field.id in active_ids]
    fields = {item.id: item for item in active_fields}
    stage_schemas: dict[str, Any] = {}
    for stage in STAGES:
        required = [
            field.id for field in active_fields if stage in field.requiredAt
        ]
        stage_schemas[stage] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": False,
            "properties": {field.id: _json_type(field) for field in active_fields},
            "required": required,
        }

    canonical = source.model_dump(mode="json")
    template_hash = hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "compilerVersion": COMPILER_VERSION,
        "templateHash": template_hash,
        "source": canonical,
        "schemas": stage_schemas,
        "ui": _block_index(source.layout, fields),
        "view": _block_index(source.layout, fields),
        "indexPlan": {
            "titleField": source.indexing.titleField,
            "summaryField": source.indexing.summaryField,
            "fullTextField": source.indexing.fullTextField,
        },
        "dependencies": {field.id: [] for field in active_fields},
    }


def parse_yaml_template(text: str) -> dict[str, Any]:
    if "<<:" in text:
        raise TemplateCompileError([Diagnostic(path="$", message="YAML merge key 不允许")])
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        path = f"line {mark.line + 1}, column {mark.column + 1}" if mark else "$"
        raise TemplateCompileError([Diagnostic(path=path, message=str(exc))]) from exc
    if not isinstance(data, dict):
        raise TemplateCompileError([Diagnostic(path="$", message="模板必须是 YAML 对象")])
    compile_template(data)
    return data


def export_yaml_template(source: dict[str, Any]) -> str:
    canonical = TemplateSource.model_validate(source).model_dump(mode="json")
    return yaml.safe_dump(canonical, allow_unicode=True, sort_keys=False, width=100)


def validate_content(
    source_dict: dict[str, Any], values: dict[str, Any], stage: Literal["draft", "submit", "publish"]
) -> list[Diagnostic]:
    source = TemplateSource.model_validate(source_dict)
    active_ids = _active_field_ids(source)
    fields = {item.id: item for item in source.fields if item.id in active_ids}
    declared_ids = {item.id for item in source.fields}
    diagnostics: list[Diagnostic] = []
    for key in values:
        if key not in fields and key not in declared_ids:
            diagnostics.append(Diagnostic(path=key, message="未知字段"))

    for field in fields.values():
        value = values.get(field.id)
        required = stage in field.requiredAt
        if value is None or value == "" or value == [] or value == {}:
            if required:
                diagnostics.append(Diagnostic(path=field.id, message="必填字段"))
            continue
        if not _matches_type(field, value):
            diagnostics.append(
                Diagnostic(path=field.id, message=f"类型不匹配，期望 {field.type}")
            )
    return diagnostics


def _matches_type(field: TemplateField, value: Any) -> bool:
    if field.type in {"string", "text"}:
        return isinstance(value, str) and len(value) <= 100_000
    if field.type == "enum":
        return isinstance(value, str) and value in {item.value for item in field.options}
    if field.type == "array":
        return isinstance(value, list) and len(value) <= 200 and all(
            isinstance(item, str) for item in value
        )
    if field.type == "object":
        return isinstance(value, dict)
    if field.type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field.type == "boolean":
        return isinstance(value, bool)
    if field.type == "date":
        if not isinstance(value, str):
            return False
        try:
            date.fromisoformat(value)
            return True
        except ValueError:
            return False
    if field.type == "asset":
        return isinstance(value, str) and bool(re.fullmatch(r"asset_[a-f0-9]{32}", value))
    if field.type == "richtext":
        return isinstance(value, dict) and value.get("type") == "doc"
    return False


def plain_text_from_richtext(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return str(node.get("text") or "")
    parts = [plain_text_from_richtext(child) for child in node.get("content", [])]
    return " ".join(part for part in parts if part).strip()


def build_search_document(
    *,
    document_id: str,
    tenant_id: str,
    title: str,
    template_version_id: str,
    values: dict[str, Any],
    source: dict[str, Any],
    generation: int,
) -> dict[str, Any]:
    fields = {item.id: item for item in TemplateSource.model_validate(source).fields}
    plan = source.get("indexing", {})
    summary_field = plan.get("summaryField", "")
    full_text_field = plan.get("fullTextField", "")

    summary = values.get(summary_field, "") if summary_field else ""
    if isinstance(summary, dict):
        summary = plain_text_from_richtext(summary)
    full_text = title
    if full_text_field and full_text_field in values:
        raw = values[full_text_field]
        full_text = plain_text_from_richtext(raw) if isinstance(raw, dict) else str(raw or "")
    if not full_text:
        full_text = " ".join(
            plain_text_from_richtext(value) if isinstance(value, dict) else str(value)
            for value in values.values()
            if isinstance(value, (str, dict))
        ).strip()

    return {
        "documentId": document_id,
        "tenantId": tenant_id,
        "title": title,
        "summary": str(summary or ""),
        "fullText": full_text,
        "values": values,
        "templateVersionId": template_version_id,
        "status": "published",
        "generation": generation,
        "fieldTypes": {field_id: field.type for field_id, field in fields.items()},
    }
