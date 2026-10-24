import type { BlockKind, LayoutBlock, TemplateSource } from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function blockId(): string {
  return newId("b");
}

export function fieldId(): string {
  return newId("f");
}

export function emptyBlock(kind: BlockKind, id = blockId()): LayoutBlock {
  const container = kind === "stack" || kind === "section" || kind === "columns";
  return {
    id,
    kind,
    title: kind === "section" ? "新分组" : "",
    fieldId: null,
    text: kind === "staticText" ? "说明文字" : "",
    children: container ? [] : [],
  };
}

export function starterTemplate(name: string, description = ""): TemplateSource {
  const titleId = "title";
  const summaryId = "summary";
  const bodyId = "body";
  return {
    schemaVersion: 1,
    metadata: { name, description },
    fields: [
      { id: titleId, type: "string", label: "标题", placeholder: "输入文档标题", help: "", requiredAt: ["submit", "publish"], options: [] },
      { id: summaryId, type: "text", label: "摘要", placeholder: "用一两句话概括内容", help: "", requiredAt: ["submit", "publish"], options: [] },
      { id: bodyId, type: "richtext", label: "正文", placeholder: "", help: "支持段落、标题、列表、表格、链接与图片", requiredAt: ["publish"], options: [] },
    ],
    layout: {
      id: "root",
      kind: "stack",
      title: "",
      fieldId: null,
      text: "",
      children: [
        {
          id: "sec_main",
          kind: "section",
          title: "文档内容",
          fieldId: null,
          text: "",
          children: [
            { id: "slot_title", kind: "field", title: "", fieldId: titleId, text: "", children: [] },
            { id: "slot_summary", kind: "field", title: "", fieldId: summaryId, text: "", children: [] },
            { id: "slot_body", kind: "richText", title: "", fieldId: bodyId, text: "", children: [] },
          ],
        },
      ],
    },
    workflow: { singleReview: true },
    indexing: { titleField: titleId, summaryField: summaryId, fullTextField: bodyId },
  };
}
