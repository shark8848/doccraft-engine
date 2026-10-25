from __future__ import annotations

import copy

import pytest

from app.compiler import (
    TemplateCompileError,
    build_search_document,
    compile_template,
    export_yaml_template,
    parse_yaml_template,
    validate_content,
)
from app.template_fixture import minimal_template


def test_compile_minimal_template_has_stage_schemas_and_hash() -> None:
    compiled = compile_template(minimal_template())
    assert compiled["compilerVersion"] == "1.1"
    assert len(compiled["templateHash"]) == 64
    assert compiled["schemas"]["publish"]["required"] == ["title", "body"]
    assert compiled["indexPlan"]["titleField"] == "title"


def test_duplicate_field_id_is_rejected() -> None:
    source = minimal_template()
    source["fields"].append(copy.deepcopy(source["fields"][0]))
    with pytest.raises(TemplateCompileError) as exc:
        compile_template(source)
    assert any("字段 ID 重复" in item.message for item in exc.value.diagnostics)


def test_dangling_layout_field_is_rejected() -> None:
    source = minimal_template()
    source["layout"]["children"][0]["children"][0]["fieldId"] = "missing_field"
    with pytest.raises(TemplateCompileError) as exc:
        compile_template(source)
    assert any("字段不存在" in item.message for item in exc.value.diagnostics)


def test_richtext_block_must_reference_richtext_field() -> None:
    source = minimal_template()
    source["layout"]["children"][0]["children"][1]["fieldId"] = "title"
    with pytest.raises(TemplateCompileError) as exc:
        compile_template(source)
    assert any("richtext" in item.message for item in exc.value.diagnostics)


def test_required_at_is_enforced_per_stage() -> None:
    source = minimal_template()
    diagnostics = validate_content(source, {"title": "", "body": {"type": "doc", "content": []}}, "publish")
    assert {item.path for item in diagnostics} == {"title"}
    assert validate_content(source, {"title": "标题"}, "draft") == []


def test_unused_fields_are_not_compiled_or_validated() -> None:
    source = minimal_template()
    source["fields"].append(
        {
            "id": "old_field",
            "type": "string",
            "label": "已删除区块留下的旧字段",
            "requiredAt": ["publish"],
        }
    )
    compiled = compile_template(source)
    assert "old_field" not in compiled["schemas"]["publish"]["properties"]
    assert "old_field" not in compiled["schemas"]["publish"]["required"]
    assert "old_field" not in compiled["dependencies"]
    assert validate_content(
        source,
        {"title": "标题", "body": {"type": "doc", "content": []}, "old_field": "旧值"},
        "publish",
    ) == []


def test_dynamic_enum_uses_lookup_source_without_static_values() -> None:
    source = minimal_template()
    source["fields"].append(
        {
            "id": "city_code",
            "type": "enum",
            "label": "地市",
            "requiredAt": ["publish"],
            "optionsSource": {"sourceId": "src_zhejiang_cities"},
        }
    )
    source["layout"]["children"][0]["children"].append(
        {"id": "slot_city", "kind": "field", "fieldId": "city_code"}
    )
    compiled = compile_template(source)
    schema = compiled["schemas"]["publish"]["properties"]["city_code"]
    assert "enum" not in schema
    assert schema["type"] == "string"
    assert validate_content(
        source,
        {
            "title": "杭州指南",
            "body": {"type": "doc", "content": []},
            "city_code": "330100",
        },
        "publish",
    ) == []


def test_enum_cannot_mix_static_options_and_lookup_source() -> None:
    source = minimal_template()
    source["fields"].append(
        {
            "id": "city_code",
            "type": "enum",
            "label": "地市",
            "options": [{"value": "330100", "label": "杭州市"}],
            "optionsSource": {"sourceId": "src_zhejiang_cities"},
        }
    )
    with pytest.raises(TemplateCompileError) as exc:
        compile_template(source)
    assert any("不能同时配置" in item.message for item in exc.value.diagnostics)


def test_yaml_round_trip_and_merge_key_rejection() -> None:
    yaml_text = export_yaml_template(minimal_template())
    assert parse_yaml_template(yaml_text)["metadata"]["name"] == "测试模板"
    with pytest.raises(TemplateCompileError):
        parse_yaml_template("defaults: &defaults\n  a: 1\ntemplate:\n  <<: *defaults\n")


def test_search_projection_extracts_richtext_text() -> None:
    source = minimal_template()
    values = {
        "title": "安装指南",
        "body": {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "先检查电源"}]},
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {"type": "tableCell", "attrs": {"header": True}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "步骤"}]}]},
                                {"type": "tableCell", "attrs": {"header": True}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "操作"}]}]},
                            ],
                        }
                    ],
                },
            ],
        },
    }
    document = build_search_document(
        document_id="doc_1",
        tenant_id="tenant_1",
        title="安装指南",
        template_version_id="tpv_1",
        values=values,
        source=source,
        generation=1,
    )
    assert "先检查电源" in document["fullText"]
    assert "步骤 操作" in document["fullText"]
    assert document["status"] == "published"
