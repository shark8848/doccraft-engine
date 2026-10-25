import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Input,
  Modal,
  Select,
  Segmented,
  Space,
  Tooltip,
} from "antd";
import {
  AlignLeftOutlined,
  AppstoreAddOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  ColumnWidthOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  FontSizeOutlined,
  HolderOutlined,
  ImportOutlined,
  PictureOutlined,
  RedoOutlined,
  SaveOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, api } from "../api";
import { EmptyState, InlineError, StatusPill, formatDate } from "../components/Common";
import {
  appendToContainer,
  blockDepth,
  containsBlock,
  findBlock,
  insertBefore,
  isContainer,
  parentOf,
  referencedFieldIds,
  removeBlock,
  updateBlock,
  updateFieldReferences,
} from "../layout";
import { emptyBlock, fieldId as makeFieldId, newId } from "../templateDefaults";
import type { BlockKind, FieldType, LayoutBlock, Stage, TemplateDetail, TemplateField, TemplateSource } from "../types";

const STAGES: { value: Stage; label: string }[] = [
  { value: "draft", label: "草稿" },
  { value: "submit", label: "提交" },
  { value: "publish", label: "发布" },
];
const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "string", label: "单行文本" },
  { value: "text", label: "长文本" },
  { value: "richtext", label: "富文本" },
  { value: "enum", label: "单选" },
  { value: "array", label: "文本列表" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "开关" },
  { value: "date", label: "日期" },
  { value: "asset", label: "媒体资产" },
  { value: "object", label: "对象" },
];
const BLOCK_LABELS: Record<BlockKind, string> = {
  stack: "纵向容器",
  section: "分组",
  columns: "分栏",
  field: "字段",
  richText: "富文本",
  asset: "媒体",
  staticText: "说明文字",
};
const PALETTE: { kind: BlockKind; label: string; icon: React.ReactNode }[] = [
  { kind: "field", label: "字段", icon: <FontSizeOutlined /> },
  { kind: "richText", label: "富文本", icon: <AlignLeftOutlined /> },
  { kind: "asset", label: "媒体", icon: <PictureOutlined /> },
  { kind: "section", label: "分组", icon: <AppstoreAddOutlined /> },
  { kind: "columns", label: "分栏", icon: <ColumnWidthOutlined /> },
  { kind: "stack", label: "容器", icon: <HolderOutlined /> },
  { kind: "staticText", label: "说明", icon: <FileTextOutlined /> },
];

interface DragPayload {
  type: "palette" | "move";
  kind?: BlockKind;
  blockId?: string;
}

function makePaletteBlock(kind: BlockKind, source: TemplateSource): { block: LayoutBlock; source: TemplateSource } {
  const block = emptyBlock(kind, newId("b"));
  if (kind !== "field" && kind !== "richText" && kind !== "asset") return { block, source };
  const type: FieldType = kind === "richText" ? "richtext" : kind === "asset" ? "asset" : "string";
  const field: TemplateField = {
    id: makeFieldId(),
    type,
    label: kind === "richText" ? "正文" : kind === "asset" ? "附件" : "新字段",
    placeholder: "",
    help: "",
    requiredAt: [],
    options: [],
  };
  block.fieldId = field.id;
  return { block, source: { ...source, fields: [...source.fields, field] } };
}

function fieldTypePatch(field: TemplateField, type: FieldType): Partial<TemplateField> {
  if (type !== "enum") return { type, options: [] };
  if (field.options?.length) return { type };
  return { type, options: [{ value: "option_1", label: "选项 1" }] };
}

function parseEnumOptions(text: string): NonNullable<TemplateField["options"]> {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("|");
    const value = (separator >= 0 ? line.slice(0, separator) : line).trim();
    const label = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    return { value, label: label || value };
  }).filter((option) => option.value);
}

function serializeEnumOptions(options: NonNullable<TemplateField["options"]>): string {
  return options.map((option) => `${option.value}|${option.label}`).join("\n");
}

function EnumOptionsEditor({ field, onChange }: { field: TemplateField; onChange: (patch: Partial<TemplateField>) => void }) {
  const serialized = serializeEnumOptions(field.options ?? []);
  const [text, setText] = useState(serialized);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(serialized);
  }, [serialized]);

  return (
    <Input.TextArea
      rows={4}
      aria-label="选项（每行“值|显示名”）"
      value={text}
      onFocus={() => { editing.current = true; }}
      onChange={(event) => {
        setText(event.target.value);
        onChange({ options: parseEnumOptions(event.target.value) });
      }}
      onBlur={() => {
        editing.current = false;
        const options = parseEnumOptions(text);
        setText(serializeEnumOptions(options));
        onChange({ options });
      }}
    />
  );
}

function FieldDefinitionFields({ field, onChange }: { field: TemplateField; onChange: (patch: Partial<TemplateField>) => void }) {
  return (
    <>
      <label className="form-label">显示名称</label>
      <Input value={field.label} maxLength={200} onChange={(event) => onChange({ label: event.target.value })} />
      <div className="form-hint">字段 ID：<code>{field.id}</code>（稳定标识，不可修改）</div>
      <label className="form-label" style={{ marginTop: 9 }}>字段类型</label>
      <Select style={{ width: "100%" }} value={field.type} options={FIELD_TYPES} onChange={(value: FieldType) => onChange(fieldTypePatch(field, value))} />
      <label className="form-label" style={{ marginTop: 9 }}>占位提示</label>
      <Input value={field.placeholder ?? ""} onChange={(event) => onChange({ placeholder: event.target.value })} />
      <label className="form-label" style={{ marginTop: 9 }}>帮助说明</label>
      <Input.TextArea rows={2} value={field.help ?? ""} onChange={(event) => onChange({ help: event.target.value })} />
      {field.type === "enum" && (
        <>
          <label className="form-label" style={{ marginTop: 9 }}>选项（每行“值|显示名”）</label>
          <EnumOptionsEditor field={field} onChange={onChange} />
        </>
      )}
      <label className="form-label" style={{ marginTop: 9 }}>必填阶段</label>
      <Checkbox.Group value={field.requiredAt} options={STAGES} onChange={(values) => onChange({ requiredAt: values as Stage[] })} />
    </>
  );
}

function insertBlock(source: TemplateSource, block: LayoutBlock, beforeId: string | null, containerId: string | null): TemplateSource {
  let layout = source.layout;
  if (beforeId) layout = insertBefore(layout, beforeId, block);
  else layout = appendToContainer(layout, containerId ?? source.layout.id, block);
  return { ...source, layout };
}

function PreviewBlock({ block, fields }: { block: LayoutBlock; fields: TemplateField[] }) {
  const field = fields.find((item) => item.id === block.fieldId);
  if (block.kind === "section") {
    return <section className="form-field"><div className="section-divider">{block.title || "未命名分组"}</div>{block.children.map((child) => <PreviewBlock key={child.id} block={child} fields={fields} />)}</section>;
  }
  if (block.kind === "columns") {
    return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>{block.children.map((child) => <PreviewBlock key={child.id} block={child} fields={fields} />)}</div>;
  }
  if (block.kind === "staticText") return <p style={{ color: "var(--text-dim)" }}>{block.text || "说明文字"}</p>;
  if (block.kind === "richText") return <div className="form-field"><div className="form-field-label">{field?.label ?? "富文本"}</div><div className="rich-content" style={{ border: "1px solid var(--border)", borderRadius: 8, minHeight: 120 }}>正文内容将在这里编辑。</div></div>;
  if (block.kind === "asset") return <div className="form-field"><div className="form-field-label">{field?.label ?? "媒体"}</div><div className="asset-slot">上传或选择媒体资产</div></div>;
  if (block.kind === "field") return <div className="form-field"><div className="form-field-label">{field?.label ?? "未关联字段"}{field?.requiredAt.includes("publish") && <span className="required-mark">*</span>}</div><Input placeholder={field?.placeholder || "请输入"} /></div>;
  return <div>{block.children.map((child) => <PreviewBlock key={child.id} block={child} fields={fields} />)}</div>;
}

export function TemplateEditorPage() {
  const { templateId = "" } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [source, setSource] = useState<TemplateSource | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [past, setPast] = useState<TemplateSource[]>([]);
  const [future, setFuture] = useState<TemplateSource[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"form" | "read">("form");
  const [diagnostics, setDiagnostics] = useState<{ path: string; message: string }[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setError("");
    api.template(templateId)
      .then((response) => {
        setDetail(response.data);
        setSource(response.data.source);
        setEtag(response.etag ?? `"${response.data.controlVersion}"`);
        setPast([]);
        setFuture([]);
        setEditingFieldId(null);
        setDirty(false);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [templateId]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const selected = useMemo(() => (source && selectedId ? findBlock(source.layout, selectedId) : null), [source, selectedId]);
  const selectedField = useMemo(() => (source && selected?.fieldId ? source.fields.find((item) => item.id === selected.fieldId) ?? null : null), [source, selected]);
  const editingField = useMemo(() => (source && editingFieldId ? source.fields.find((item) => item.id === editingFieldId) ?? null : null), [source, editingFieldId]);

  function commit(next: TemplateSource) {
    if (!source) return;
    setPast((items) => [...items.slice(-39), source]);
    setFuture([]);
    setSource(next);
    setDirty(true);
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous || !source) return;
    setFuture((items) => [source, ...items].slice(0, 40));
    setPast((items) => items.slice(0, -1));
    setSource(previous);
    setDirty(true);
  }

  function redo() {
    const next = future[0];
    if (!next || !source) return;
    setPast((items) => [...items, source]);
    setFuture((items) => items.slice(1));
    setSource(next);
    setDirty(true);
  }

  function patchSource(patch: Partial<TemplateSource>) {
    if (source) commit({ ...source, ...patch });
  }

  function addPaletteBlock(kind: BlockKind, beforeId: string | null = null, containerId: string | null = null) {
    if (!source) return;
    const made = makePaletteBlock(kind, source);
    commit(insertBlock(made.source, made.block, beforeId, containerId));
    setSelectedId(made.block.id);
  }

  function addFromPalette(kind: BlockKind) {
    if (!source) return;
    if (selectedId) {
      const target = findBlock(source.layout, selectedId);
      if (target && isContainer(target)) { addPaletteBlock(kind, null, target.id); return; }
      if (target) { addPaletteBlock(kind, target.id); return; }
    }
    addPaletteBlock(kind, null, source.layout.id);
  }

  function handleDrop(targetId: string | null, containerId: string | null) {
    if (!source || !drag) return;
    if (drag.type === "palette" && drag.kind) {
      const made = makePaletteBlock(drag.kind, source);
      commit(insertBlock(made.source, made.block, targetId, containerId));
      setSelectedId(made.block.id);
    } else if (drag.type === "move" && drag.blockId) {
      if (drag.blockId === targetId || drag.blockId === containerId) return;
      const moving = findBlock(source.layout, drag.blockId);
      if (!moving) return;
      if (targetId && containsBlock(moving, targetId)) return;
      if (containerId && containsBlock(moving, containerId)) return;
      const layout = removeBlock(source.layout, drag.blockId);
      const nextLayout = targetId ? insertBefore(layout, targetId, moving) : appendToContainer(layout, containerId ?? source.layout.id, moving);
      commit({ ...source, layout: nextLayout });
      setSelectedId(moving.id);
    }
    setDrag(null);
    setDropTarget(null);
  }

  function deleteBlock(id: string) {
    if (!source) return;
    const block = findBlock(source.layout, id);
    if (!block) return;
    const remove = () => {
      const layout = removeBlock(source.layout, id);
      const removedFields = referencedFieldIds(block);
      const remainingFields = referencedFieldIds(layout);
      const indexedFields = new Set([
        source.indexing.titleField,
        source.indexing.summaryField,
        source.indexing.fullTextField,
      ].filter(Boolean));
      const fields = source.fields.filter((field) =>
        !removedFields.has(field.id) || remainingFields.has(field.id) || indexedFields.has(field.id)
      );
      commit({ ...source, layout, fields });
      setSelectedId(null);
    };
    if (isContainer(block) && block.children.length > 0) {
      modal.confirm({ title: "删除整个区块？", content: "区块内的子区块及不再被引用的字段会一并删除。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: remove });
    } else {
      remove();
    }
  }

  function moveSibling(id: string, direction: -1 | 1) {
    if (!source) return;
    const parent = parentOf(source.layout, id);
    if (!parent) return;
    const index = parent.children.findIndex((item) => item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= parent.children.length) return;
    const reordered = [...parent.children];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    commit({ ...source, layout: updateBlock(source.layout, parent.id, (block) => ({ ...block, children: reordered })) });
  }

  function updateSelected(patch: Partial<LayoutBlock>) {
    if (!source || !selectedId) return;
    commit({ ...source, layout: updateBlock(source.layout, selectedId, (block) => ({ ...block, ...patch })) });
  }

  function updateField(id: string, patch: Partial<TemplateField>) {
    if (!source) return;
    const nextFields = source.fields.map((field) => field.id === id ? { ...field, ...patch } : field);
    let layout = source.layout;
    if (patch.type && patch.type !== source.fields.find((field) => field.id === id)?.type) {
      const kind = patch.type === "richtext" ? "richText" : patch.type === "asset" ? "asset" : "field";
      layout = updateFieldReferences(layout, id, (block) => ({ ...block, kind }));
    }
    commit({ ...source, fields: nextFields, layout });
  }

  function addField(type: FieldType = "string") {
    if (!source) return;
    const field: TemplateField = { id: makeFieldId(), type, label: "新字段", placeholder: "", help: "", requiredAt: [], options: [] };
    commit({ ...source, fields: [...source.fields, field] });
    setEditingFieldId(field.id);
    message.success("字段已添加，可直接编辑");
  }

  function deleteField(id: string) {
    if (!source) return;
    const used = findBlock(source.layout, selectedId ?? "")?.fieldId === id || containsField(source.layout, id);
    if (used) { message.warning("该字段仍被画布引用，请先删除对应区块"); return; }
    if (source.indexing.titleField === id) {
      message.warning("该字段当前作为标题索引字段，请先切换标题字段");
      return;
    }
    const indexing = {
      ...source.indexing,
      summaryField: source.indexing.summaryField === id ? "" : source.indexing.summaryField,
      fullTextField: source.indexing.fullTextField === id ? "" : source.indexing.fullTextField,
    };
    commit({ ...source, fields: source.fields.filter((field) => field.id !== id), indexing });
    if (editingFieldId === id) setEditingFieldId(null);
  }

  function save(): Promise<TemplateDetail | null> {
    return new Promise((resolve) => {
      if (!source || !etag) { resolve(null); return; }
      setSaving(true);
      api.saveTemplate(templateId, source, etag)
        .then((response) => {
          setDetail(response.data);
          setSource(response.data.source);
          setEtag(response.etag);
          setDirty(false);
          message.success("草稿已保存");
          resolve(response.data);
        })
        .catch((reason: unknown) => {
          if (reason instanceof ApiError && reason.status === 412) {
            modal.confirm({ title: "保存冲突", content: "模板已被其他会话更新。重新加载最新版本会丢弃本地改动。", okText: "重新加载", cancelText: "保留本地", onOk: load });
          } else if (reason instanceof ApiError && Array.isArray(reason.payload.diagnostics)) {
            setDiagnostics(reason.payload.diagnostics as { path: string; message: string }[]);
          } else {
            message.error(reason instanceof Error ? reason.message : "保存失败");
          }
          resolve(null);
        })
        .finally(() => setSaving(false));
    });
  }

  async function validate() {
    if (!source) return;
    setSaving(true);
    try {
      await api.validateTemplate(templateId, source);
      setDiagnostics([]);
      message.success("模板校验通过");
    } catch (reason) {
      if (reason instanceof ApiError && Array.isArray(reason.payload.diagnostics)) setDiagnostics(reason.payload.diagnostics as { path: string; message: string }[]);
      else message.error(reason instanceof Error ? reason.message : "校验失败");
    } finally { setSaving(false); }
  }

  async function publish() {
    if (!source) return;
    setPublishing(true);
    try {
      if (dirty) {
        const saved = await save();
        if (!saved) return;
      }
      await api.validateTemplate(templateId, source);
      await api.publishTemplate(templateId);
      message.success("模板版本已发布");
      load();
    } catch (reason) {
      if (reason instanceof ApiError && Array.isArray(reason.payload.diagnostics)) setDiagnostics(reason.payload.diagnostics as { path: string; message: string }[]);
      else message.error(reason instanceof Error ? reason.message : "发布失败");
    } finally { setPublishing(false); }
  }

  async function exportYaml() {
    try {
      const text = await api.exportYaml(templateId);
      const url = URL.createObjectURL(new Blob([text], { type: "application/yaml;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${source?.metadata.name || templateId}.yaml`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { message.error(reason instanceof Error ? reason.message : "导出失败"); }
  }

  async function importYaml() {
    const text = yamlText;
    if (!text.trim()) { message.warning("请粘贴 YAML 或选择文件"); return; }
    try {
      const result = await api.importYaml(text);
      commit(result.source);
      setImportOpen(false);
      setYamlText("");
      message.success("YAML 已导入，本地仍未保存");
    } catch (reason) {
      if (reason instanceof ApiError && Array.isArray(reason.payload.diagnostics)) setDiagnostics(reason.payload.diagnostics as { path: string; message: string }[]);
      else message.error(reason instanceof Error ? reason.message : "导入失败");
    }
  }

  if (loading) return <div className="page"><div className="skeleton-card" style={{ height: 260, marginTop: 20 }} /></div>;
  if (error || !source) return <div className="page"><InlineError message={error || "模板不存在"} onRetry={load} /></div>;

  const titleField = source.fields.find((field) => field.id === source.indexing.titleField);
  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => { if (!dirty || window.confirm("有未保存的改动，确定离开？")) navigate("/templates"); }}>返回</Button>
        <div className="editor-title">
          <h1>{dirty && <span className="dirty-dot" />}{source.metadata.name || "未命名模板"}</h1>
          <p>控制版本 {detail?.controlVersion ?? 1} · {detail?.publishedVersion ? `已发布 v${detail.publishedVersion.version}` : "尚未发布"}{dirty ? " · 有未保存改动" : ""}</p>
        </div>
        <Space size={4}>
          <Tooltip title="撤销 (Ctrl+Z)"><Button type="text" icon={<UndoOutlined />} disabled={past.length === 0} onClick={undo} aria-label="撤销" /></Tooltip>
          <Tooltip title="重做 (Ctrl+Shift+Z)"><Button type="text" icon={<RedoOutlined />} disabled={future.length === 0} onClick={redo} aria-label="重做" /></Tooltip>
          <Button type="text" icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入</Button>
          <Button type="text" icon={<DownloadOutlined />} onClick={() => void exportYaml()}>导出</Button>
          <Button icon={<CheckCircleOutlined />} loading={saving} onClick={() => void validate()}>校验</Button>
          <Button icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存</Button>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>预览</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={publishing} onClick={() => void publish()}>发布</Button>
        </Space>
      </header>

      <div className="editor-body">
        <aside className="editor-pane left" aria-label="组件面板">
          <div className="pane-title">组件</div>
          <div className="palette">
            {PALETTE.map((item) => (
              <div
                className="palette-item"
                key={item.kind}
                role="button"
                tabIndex={0}
                draggable
                onDragStart={() => setDrag({ type: "palette", kind: item.kind })}
                onDragEnd={() => { setDrag(null); setDropTarget(null); }}
                onClick={() => addFromPalette(item.kind)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); addFromPalette(item.kind); } }}
                title={`添加${item.label}（也可拖入画布）`}
              >
                {item.icon}<span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="field-mini-list">
            <div className="pane-title">字段 <span style={{ marginLeft: "auto" }}><Button size="small" type="text" icon={<AppstoreAddOutlined />} onClick={() => addField()}>添加</Button></span></div>
            {source.fields.map((field) => (
              <div
                className={`field-mini${editingFieldId === field.id ? " selected" : ""}`}
                key={field.id}
                role="button"
                tabIndex={0}
                title={`编辑字段：${field.label}`}
                onClick={() => setEditingFieldId(field.id)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditingFieldId(field.id); } }}
              >
                <FileTextOutlined /><span className="truncate">{field.label}</span><code>{field.type}</code>
              </div>
            ))}
          </div>
        </aside>

        <main
          className="editor-canvas-wrap"
          onClick={() => setSelectedId(null)}
          onDragOver={(event) => { event.preventDefault(); setDropTarget(source.layout.id); }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); handleDrop(null, source.layout.id); }}
        >
          <div className="canvas-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="canvas-meta">
              <h2>{source.metadata.name || "未命名模板"}</h2>
              <p>{source.metadata.description || "拖入左侧组件开始编排"}</p>
            </div>
            <CanvasBlock
              block={source.layout}
              source={source}
              selectedId={selectedId}
              dropTarget={dropTarget}
              depth={0}
              onSelect={setSelectedId}
              onDragStart={(id) => setDrag({ type: "move", blockId: id })}
              onDragEnd={() => { setDrag(null); setDropTarget(null); }}
              onDragOver={(id) => setDropTarget(id)}
              onDrop={(beforeId, containerId) => handleDrop(beforeId, containerId)}
              onMove={moveSibling}
              onDelete={deleteBlock}
            />
            {source.layout.children.length === 0 && (
              <div className="canvas-empty"><AppstoreAddOutlined style={{ fontSize: 30 }} /><strong>从左侧拖入区块</strong><span>也可以点击组件，将它添加到当前选中位置</span></div>
            )}
          </div>
        </main>

        <aside className="editor-pane right" aria-label="属性面板">
          <div className="pane-title">属性</div>
          {selected ? (
            <div className="form-stack">
              <div className="property-group">
                <h3>{BLOCK_LABELS[selected.kind]}设置</h3>
                <label className="form-label">区块类型</label>
                <Input value={BLOCK_LABELS[selected.kind]} disabled />
                {selected.kind === "section" && <><label className="form-label" style={{ marginTop: 9 }}>分组标题</label><Input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} /></>}
                {selected.kind === "staticText" && <><label className="form-label" style={{ marginTop: 9 }}>说明文字</label><Input.TextArea rows={4} value={selected.text} onChange={(event) => updateSelected({ text: event.target.value })} /></>}
                {(selected.kind === "field" || selected.kind === "richText" || selected.kind === "asset") && (
                  <>
                    <label className="form-label" style={{ marginTop: 9 }}>引用字段</label>
                    <Select
                      style={{ width: "100%" }}
                      value={selected.fieldId ?? undefined}
                      placeholder="选择字段"
                      options={source.fields.map((field) => ({ value: field.id, label: `${field.label} · ${field.type}` }))}
                      onChange={(value) => updateSelected({ fieldId: value })}
                    />
                    {!selectedField && <div className="form-hint" style={{ color: "var(--err)" }}>该区块还没有关联字段，发布校验会失败。</div>}
                  </>
                )}
              </div>

              {selectedField && (
                <div className="property-group">
                  <h3>字段定义</h3>
                  <FieldDefinitionFields field={selectedField} onChange={(patch) => updateField(selectedField.id, patch)} />
                </div>
              )}

              <div className="property-group">
                <h3>结构</h3>
                <Space wrap>
                  <Button size="small" icon={<ArrowUpOutlined />} onClick={() => moveSibling(selected.id, -1)}>上移</Button>
                  <Button size="small" icon={<ArrowDownOutlined />} onClick={() => moveSibling(selected.id, 1)}>下移</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteBlock(selected.id)}>删除</Button>
                </Space>
                <div className="form-hint">拖住区块左侧手柄可移动到其他容器，或拖到目标区块前。</div>
              </div>
            </div>
          ) : (
            <div className="form-stack">
              <div className="property-group">
                <h3>模板设置</h3>
                <label className="form-label">模板名称</label>
                <Input value={source.metadata.name} onChange={(event) => patchSource({ metadata: { ...source.metadata, name: event.target.value } })} />
                <label className="form-label" style={{ marginTop: 9 }}>说明</label>
                <Input.TextArea rows={3} value={source.metadata.description} onChange={(event) => patchSource({ metadata: { ...source.metadata, description: event.target.value } })} />
              </div>
              <div className="property-group">
                <h3>检索字段</h3>
                <label className="form-label">标题</label>
                <Select style={{ width: "100%" }} value={source.indexing.titleField} options={source.fields.map((field) => ({ value: field.id, label: field.label }))} onChange={(value) => patchSource({ indexing: { ...source.indexing, titleField: value } })} />
                <label className="form-label" style={{ marginTop: 9 }}>摘要</label>
                <Select style={{ width: "100%" }} value={source.indexing.summaryField || undefined} allowClear options={source.fields.map((field) => ({ value: field.id, label: field.label }))} onChange={(value) => patchSource({ indexing: { ...source.indexing, summaryField: value ?? "" } })} />
                <label className="form-label" style={{ marginTop: 9 }}>全文</label>
                <Select style={{ width: "100%" }} value={source.indexing.fullTextField || undefined} allowClear options={source.fields.map((field) => ({ value: field.id, label: field.label }))} onChange={(value) => patchSource({ indexing: { ...source.indexing, fullTextField: value ?? "" } })} />
              </div>
              <div className="property-group">
                <h3>字段</h3>
                {source.fields.map((field) => (
                  <div className={`field-row${editingFieldId === field.id ? " selected" : ""}`} key={field.id}>
                    <div className="field-row-main" role="button" tabIndex={0} onClick={() => setEditingFieldId(field.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditingFieldId(field.id); } }}><strong>{field.label}</strong><span>{field.type} · {field.id}</span></div>
                    <div className="field-row-actions">
                      <button type="button" aria-label="编辑字段" title="编辑字段" onClick={() => setEditingFieldId(field.id)}><EditOutlined /></button>
                      <button type="button" className="danger" aria-label="删除字段" title="删除字段" onClick={() => deleteField(field.id)}><DeleteOutlined /></button>
                    </div>
                  </div>
                ))}
                <Button block icon={<AppstoreAddOutlined />} style={{ marginTop: 8 }} onClick={() => addField()}>添加字段</Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <Drawer
        title={editingField ? `编辑字段 · ${editingField.label || "未命名"}` : "编辑字段"}
        width={380}
        open={editingField !== null}
        onClose={() => setEditingFieldId(null)}
        footer={<Button type="primary" onClick={() => setEditingFieldId(null)}>完成</Button>}
      >
        {editingField && (
          <div className="form-stack">
            <FieldDefinitionFields field={editingField} onChange={(patch) => updateField(editingField.id, patch)} />
          </div>
        )}
      </Drawer>

      <Modal title="模板预览" width={860} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button onClick={() => setPreviewOpen(false)}>关闭</Button>}>
        <Segmented value={previewMode} onChange={(value) => setPreviewMode(value as typeof previewMode)} options={[{ value: "form", label: "表单预览" }, { value: "read", label: "阅读预览" }]} style={{ marginBottom: 16 }} />
        <div className="canvas-sheet" style={{ width: "100%", boxShadow: "none" }}>
          <div className="canvas-meta"><h2>{source.metadata.name}</h2><p>{source.metadata.description}</p></div>
          {previewMode === "form" ? <PreviewBlock block={source.layout} fields={source.fields} /> : (
            <article>
              <h1>{titleField?.label ?? "文档标题"}</h1>
              <p className="muted">阅读预览 · 已发布内容将按此顺序渲染</p>
              <PreviewBlock block={source.layout} fields={source.fields} />
            </article>
          )}
        </div>
      </Modal>

      <Modal title="校验结果" open={diagnostics !== null} onCancel={() => setDiagnostics(null)} footer={<Button type="primary" onClick={() => setDiagnostics(null)}>知道了</Button>}>
        {diagnostics?.length ? <div className="form-stack">{diagnostics.map((item, index) => <Alert key={index} type="error" showIcon message={item.path} description={item.message} />)}</div> : <Alert type="success" showIcon message="模板结构有效" />}
      </Modal>

      <Modal title="导入 YAML" open={importOpen} okText="校验并导入" cancelText="取消" onOk={() => void importYaml()} onCancel={() => setImportOpen(false)}>
        <input ref={fileRef} type="file" accept=".yaml,.yml,text/yaml" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(setYamlText); }} />
        <div className="toolbar"><Button icon={<ImportOutlined />} onClick={() => fileRef.current?.click()}>选择 YAML 文件</Button></div>
        <Input.TextArea rows={14} className="mono" placeholder="粘贴模板 YAML…" value={yamlText} onChange={(event) => setYamlText(event.target.value)} />
      </Modal>
    </div>
  );
}

function containsField(block: LayoutBlock, fieldId: string): boolean {
  if (block.fieldId === fieldId) return true;
  return block.children.some((child) => containsField(child, fieldId));
}

function CanvasBlock({
  block,
  source,
  selectedId,
  dropTarget,
  depth,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onDelete,
}: {
  block: LayoutBlock;
  source: TemplateSource;
  selectedId: string | null;
  dropTarget: string | null;
  depth: number;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (id: string) => void;
  onDrop: (beforeId: string | null, containerId: string | null) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
}) {
  const field = source.fields.find((item) => item.id === block.fieldId);
  const container = isContainer(block);
  const classes = ["layout-block", `block-${block.kind}`, selectedId === block.id ? "selected" : "", dropTarget === block.id ? "drag-over" : ""].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      onClick={(event) => { event.stopPropagation(); onSelect(block.id); }}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); onDragOver(block.id); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDrop(block.id, null); }}
    >
      <div className="block-toolbar" onClick={(event) => event.stopPropagation()}>
        <Tooltip title="拖动区块"><span className="block-grip" draggable onDragStart={(event) => { event.stopPropagation(); onDragStart(block.id); }} onDragEnd={onDragEnd}><HolderOutlined /></span></Tooltip>
        <Tooltip title="上移"><button type="button" aria-label="上移区块" onClick={() => onMove(block.id, -1)}><ArrowUpOutlined /></button></Tooltip>
        <Tooltip title="下移"><button type="button" aria-label="下移区块" onClick={() => onMove(block.id, 1)}><ArrowDownOutlined /></button></Tooltip>
        <Tooltip title="删除"><button type="button" aria-label="删除区块" onClick={() => onDelete(block.id)}><DeleteOutlined /></button></Tooltip>
      </div>
      <div className="block-inner">
        {block.kind === "section" && <div className="block-label">{block.title || "未命名分组"}</div>}
        {block.kind === "staticText" && <div className="block-static">{block.text || "说明文字"}</div>}
        {block.kind === "field" && <div className="block-control"><div className="block-control-tag"><FontSizeOutlined />字段</div><div className="block-control-label">{field?.label ?? "未关联字段"}</div><div className="block-control-placeholder">{field?.placeholder || "输入控件"}</div></div>}
        {block.kind === "richText" && <div className="block-control"><div className="block-control-tag"><AlignLeftOutlined />富文本</div><div className="block-control-label">{field?.label ?? "未关联字段"}</div><div className="block-control-placeholder">段落、列表、链接与图片</div></div>}
        {block.kind === "asset" && <div className="block-control"><div className="block-control-tag"><PictureOutlined />媒体</div><div className="block-control-label">{field?.label ?? "未关联字段"}</div><div className="block-control-placeholder">按 assetId 引用媒体</div></div>}
        {container && (
          <div className="block-children">
            {block.children.length === 0 ? <div className="canvas-empty" style={{ minHeight: 86 }}><span>拖入子区块</span></div> : block.children.map((child) => (
              <CanvasBlock
                key={child.id}
                block={child}
                source={source}
                selectedId={selectedId}
                dropTarget={dropTarget}
                depth={depth + 1}
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onMove={onMove}
                onDelete={onDelete}
              />
            ))}
            {depth < 6 && <div className={`drop-line${dropTarget === block.id ? " active" : ""}`} />}
          </div>
        )}
      </div>
    </div>
  );
}
