from __future__ import annotations

from typing import Any


def minimal_template() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "metadata": {"name": "测试模板", "description": "编译器测试"},
        "fields": [
            {"id": "title", "type": "string", "label": "标题", "requiredAt": ["publish"]},
            {"id": "body", "type": "richtext", "label": "正文", "requiredAt": ["publish"]},
        ],
        "layout": {
            "id": "root",
            "kind": "stack",
            "children": [
                {
                    "id": "section_main",
                    "kind": "section",
                    "title": "内容",
                    "children": [
                        {"id": "slot_title", "kind": "field", "fieldId": "title"},
                        {"id": "slot_body", "kind": "richText", "fieldId": "body"},
                    ],
                }
            ],
        },
        "workflow": {"singleReview": True},
        "indexing": {"titleField": "title", "summaryField": "", "fullTextField": "body"},
    }
