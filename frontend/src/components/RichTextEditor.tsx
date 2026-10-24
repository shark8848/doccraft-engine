import { useEffect, useRef, useState } from "react";
import { App, Button, Tooltip } from "antd";
import {
  BoldOutlined,
  CodeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PictureOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";

import { ApiError, api } from "../api";
import type { JsonRecord } from "../types";

type Mark = { type: "bold" } | { type: "italic" } | { type: "code" } | { type: "link"; attrs: { href: string } };
type RichNode = JsonRecord & { type: string; content?: RichNode[]; marks?: Mark[] };

function isDoc(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && (value as JsonRecord).type === "doc";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function htmlFromDoc(value: JsonRecord | null | undefined): string {
  if (!isDoc(value)) return "";
  const render = (node: RichNode): string => {
    const children = () => (node.content ?? []).map(render).join("");
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    if (node.type === "text") {
      let html = escapeHtml(String(node.text ?? ""));
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") html = `<strong>${html}</strong>`;
        if (mark.type === "italic") html = `<em>${html}</em>`;
        if (mark.type === "code") html = `<code>${html}</code>`;
        if (mark.type === "link") html = `<a href="${escapeHtml(String(mark.attrs?.href ?? ""))}">${html}</a>`;
      }
      return html;
    }
    switch (node.type) {
      case "paragraph": return `<p>${children()}</p>`;
      case "heading": return `<h${Number(attrs.level) === 3 ? "3" : "2"}>${children()}</h${Number(attrs.level) === 3 ? "3" : "2"}>`;
      case "bulletList": return `<ul>${children()}</ul>`;
      case "orderedList": return `<ol>${children()}</ol>`;
      case "listItem": return `<li>${children()}</li>`;
      case "blockquote": return `<blockquote>${children()}</blockquote>`;
      case "table": return `<table><tbody>${children()}</tbody></table>`;
      case "tableRow": return `<tr>${children()}</tr>`;
      case "tableCell": return `<${attrs.header ? "th" : "td"}>${children()}</${attrs.header ? "th" : "td"}>`;
      case "hardBreak": return "<br>";
      case "image": return `<img data-asset-id="${escapeHtml(String(attrs.assetId ?? ""))}" alt="${escapeHtml(String(attrs.alt ?? ""))}">`;
      case "doc": return children();
      default: return children();
    }
  };
  return (value.content as RichNode[] | undefined ?? []).map(render).join("");
}

function marksFromElement(element: HTMLElement): Mark[] {
  const marks: Mark[] = [];
  let node: HTMLElement | null = element;
  while (node) {
    const tag = node.tagName?.toLowerCase();
    if (tag === "strong" || tag === "b") marks.unshift({ type: "bold" });
    if (tag === "em" || tag === "i") marks.unshift({ type: "italic" });
    if (tag === "code") marks.unshift({ type: "code" });
    if (tag === "a") marks.unshift({ type: "link", attrs: { href: node.getAttribute("href") ?? "" } });
    node = node.parentElement;
  }
  return marks;
}

function inlineNodes(parent: Node, inherited: Mark[] = []): RichNode[] {
  const out: RichNode[] = [];
  parent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) out.push({ type: "text", text, ...(inherited.length ? { marks: inherited } : {}) });
      return;
    }
    if (!(child instanceof HTMLElement)) return;
    const tag = child.tagName.toLowerCase();
    if (tag === "br") { out.push({ type: "hardBreak" }); return; }
    if (tag === "img") {
      const assetId = child.getAttribute("data-asset-id") ?? "";
      if (assetId) out.push({ type: "image", attrs: { assetId, alt: child.getAttribute("alt") ?? "" } });
      return;
    }
    const marks = [...inherited];
    if (tag === "strong" || tag === "b") marks.push({ type: "bold" });
    if (tag === "em" || tag === "i") marks.push({ type: "italic" });
    if (tag === "code") marks.push({ type: "code" });
    if (tag === "a") marks.push({ type: "link", attrs: { href: child.getAttribute("href") ?? "" } });
    out.push(...inlineNodes(child, [...marks, ...marksFromElement(child).filter((mark) => !marks.some((item) => item.type === mark.type))]));
  });
  return out;
}

function tableCellContent(cell: HTMLTableCellElement): RichNode[] {
  const blocks = Array.from(cell.children)
    .filter((child) => ["p", "div"].includes(child.tagName.toLowerCase()))
    .map((child) => ({ type: "paragraph", content: inlineNodes(child) }));
  return blocks.length ? blocks : [{ type: "paragraph", content: inlineNodes(cell) }];
}

function blockNode(element: HTMLElement): RichNode | null {
  const tag = element.tagName.toLowerCase();
  if (tag === "p" || tag === "div") return { type: "paragraph", content: inlineNodes(element) };
  if (tag === "h1" || tag === "h2" || tag === "h3") return { type: "heading", attrs: { level: Number(tag.slice(1)) }, content: inlineNodes(element) };
  if (tag === "blockquote") return { type: "blockquote", content: [{ type: "paragraph", content: inlineNodes(element) }] };
  if (tag === "ul" || tag === "ol") {
    return {
      type: tag === "ul" ? "bulletList" : "orderedList",
      content: Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li").map((child) => ({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes(child) }] })),
    };
  }
  if (tag === "table") {
    const rows = Array.from((element as HTMLTableElement).rows).map((row) => ({
      type: "tableRow",
      content: Array.from(row.cells).map((cell) => ({
        type: "tableCell",
        attrs: { header: cell.tagName.toLowerCase() === "th" },
        content: tableCellContent(cell),
      })),
    }));
    return rows.length ? { type: "table", content: rows } : null;
  }
  if (tag === "img") {
    const assetId = element.getAttribute("data-asset-id") ?? "";
    return assetId ? { type: "image", attrs: { assetId, alt: element.getAttribute("alt") ?? "" } } : null;
  }
  const inline = inlineNodes(element);
  return inline.length ? { type: "paragraph", content: inline } : null;
}

function docFromElement(element: HTMLElement): JsonRecord {
  const content = Array.from(element.childNodes).flatMap((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      return text.trim() ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [];
    }
    if (!(node instanceof HTMLElement)) return [];
    const converted = blockNode(node);
    return converted ? [converted] : [];
  });
  return { type: "doc", content };
}

export function RichTextEditor({ value, onChange, placeholder = "开始输入正文…" }: { value: JsonRecord | null | undefined; onChange: (value: JsonRecord) => void; placeholder?: string }) {
  const { message } = App.useApp();
  const ref = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    const element = ref.current;
    if (!element || document.activeElement === element) return;
    const html = htmlFromDoc(value);
    if (element.innerHTML !== html) element.innerHTML = html;
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
    element.querySelectorAll<HTMLImageElement>("img[data-asset-id]").forEach((image) => {
      const assetId = image.dataset.assetId;
      if (!assetId) return;
      void api.assetBlob(assetId).then((blob) => {
        const url = URL.createObjectURL(blob);
        objectUrls.current.push(url);
        image.src = url;
      }).catch(() => { image.alt = `${image.alt}（资源未就绪）`; });
    });
  }, [value]);

  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function emit() {
    if (!ref.current) return;
    onChange(docFromElement(ref.current));
  }

  function command(name: string, value?: string) {
    ref.current?.focus();
    document.execCommand(name, false, value);
    emit();
  }

  function addLink() {
    const href = window.prompt("输入链接地址", "https://");
    if (href) command("createLink", href);
  }

  function currentCell(): HTMLTableCellElement | null {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const element = node instanceof HTMLElement ? node : node?.parentElement;
    return element?.closest("td,th") ?? null;
  }

  function insertTable() {
    const input = window.prompt("表格大小（行×列，含表头），例如 3×3", "3×3");
    if (input === null) return;
    const match = input.trim().match(/^(\d{1,2})\s*[x×*]\s*(\d{1,2})$/i);
    const rows = match ? Math.min(Math.max(Number(match[1]), 1), 20) : 0;
    const columns = match ? Math.min(Math.max(Number(match[2]), 1), 10) : 0;
    if (!rows || !columns) {
      message.warning("请输入有效大小，例如 3×3");
      return;
    }
    const header = `<tr>${Array.from({ length: columns }, (_, index) => `<th>列 ${index + 1}</th>`).join("")}</tr>`;
    const body = Array.from({ length: Math.max(rows - 1, 0) }, () => `<tr>${Array.from({ length: columns }, () => "<td><br></td>").join("")}</tr>`).join("");
    const existingTables = new Set(ref.current?.querySelectorAll("table"));
    command("insertHTML", `<table><tbody>${header}${body}</tbody></table><p><br></p>`);
    const table = Array.from(ref.current?.querySelectorAll("table") ?? []).find((item) => !existingTables.has(item));
    const firstCell = table?.querySelector<HTMLTableCellElement>("th, td");
    if (firstCell) {
      const range = document.createRange();
      range.selectNodeContents(firstCell);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    message.success(`已插入 ${rows}×${columns} 表格`);
  }

  function addTableRow() {
    const cell = currentCell();
    const row = cell?.parentElement as HTMLTableRowElement | null;
    if (!cell || !row) {
      message.warning("请先把光标放到表格内");
      return;
    }
    const nextRow = document.createElement("tr");
    Array.from(row.cells).forEach(() => {
      const newCell = document.createElement("td");
      newCell.innerHTML = "<br>";
      nextRow.appendChild(newCell);
    });
    row.after(nextRow);
    emit();
  }

  function addTableColumn() {
    const cell = currentCell();
    const table = cell?.closest("table") as HTMLTableElement | null;
    if (!cell || !table) {
      message.warning("请先把光标放到表格内");
      return;
    }
    const index = cell.cellIndex;
    Array.from(table.rows).forEach((row) => {
      const reference = row.cells[Math.min(index, row.cells.length - 1)];
      if (!reference) return;
      const tag = reference.tagName.toLowerCase() === "th" ? "th" : "td";
      const newCell = document.createElement(tag);
      newCell.innerHTML = tag === "th" ? `列 ${index + 2}` : "<br>";
      reference.after(newCell);
    });
    emit();
  }

  function removeTable() {
    const table = currentCell()?.closest("table");
    if (!table) {
      message.warning("请先把光标放到表格内");
      return;
    }
    table.remove();
    emit();
    message.success("表格已删除");
  }

  async function uploadImage(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      let asset = (await api.uploadAsset(file)).data;
      for (let attempt = 0; attempt < 20 && asset.status === "SCANNING"; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        asset = await api.asset(asset.id);
      }
      if (asset.status !== "READY") throw new Error("图片未通过校验");
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      ref.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${url}" data-asset-id="${asset.id}" alt="${escapeHtml(file.name)}">`);
      emit();
      message.success("图片已插入，保存草稿后生效");
    } catch (reason) {
      message.error(reason instanceof ApiError || reason instanceof Error ? reason.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (imageRef.current) imageRef.current.value = "";
    }
  }

  return (
    <div className="rich-editor">
      <input ref={imageRef} type="file" accept="image/*" hidden onChange={(event) => void uploadImage(event.target.files)} />
      <div className="rich-toolbar" role="toolbar" aria-label="富文本格式">
        <Tooltip title="加粗"><Button type="text" size="small" icon={<BoldOutlined />} onClick={() => command("bold")} /></Tooltip>
        <Tooltip title="斜体"><Button type="text" size="small" icon={<ItalicOutlined />} onClick={() => command("italic")} /></Tooltip>
        <Tooltip title="二级标题"><Button type="text" size="small" onClick={() => command("formatBlock", "<h2>")}>H2</Button></Tooltip>
        <Tooltip title="项目符号"><Button type="text" size="small" icon={<UnorderedListOutlined />} onClick={() => command("insertUnorderedList")} /></Tooltip>
        <Tooltip title="编号列表"><Button type="text" size="small" icon={<OrderedListOutlined />} onClick={() => command("insertOrderedList")} /></Tooltip>
        <Tooltip title="引用"><Button type="text" size="small" icon={<CodeOutlined />} onClick={() => command("formatBlock", "<blockquote>")} /></Tooltip>
        <Tooltip title="链接"><Button type="text" size="small" icon={<LinkOutlined />} onClick={addLink} /></Tooltip>
        <Tooltip title="插入图片"><Button type="text" size="small" icon={<PictureOutlined />} loading={uploading} onClick={() => imageRef.current?.click()} /></Tooltip>
        <Tooltip title="插入表格"><Button type="text" size="small" icon={<TableOutlined />} aria-label="插入表格" onClick={insertTable} /></Tooltip>
        <Tooltip title="增加表格行"><Button type="text" size="small" aria-label="增加表格行" onMouseDown={(event) => event.preventDefault()} onClick={addTableRow}>+行</Button></Tooltip>
        <Tooltip title="增加表格列"><Button type="text" size="small" aria-label="增加表格列" onMouseDown={(event) => event.preventDefault()} onClick={addTableColumn}>+列</Button></Tooltip>
        <Tooltip title="删除表格"><Button type="text" size="small" aria-label="删除表格" onMouseDown={(event) => event.preventDefault()} onClick={removeTable}>删表</Button></Tooltip>
      </div>
      <div
        ref={ref}
        className="rich-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="富文本正文"
        data-placeholder={placeholder}
        onInput={emit}
      />
    </div>
  );
}
