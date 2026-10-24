import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  SaveOutlined,
  SendOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, api } from "../api";
import { AssetImage, InlineError, StatusPill, formatDate } from "../components/Common";
import { RichTextEditor } from "../components/RichTextEditor";
import { findBlock } from "../layout";
import type { Asset, DocumentSummary, FieldType, JsonRecord, LayoutBlock, TemplateField } from "../types";

function defaultForType(type: FieldType): unknown {
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "richtext") return { type: "doc", content: [] };
  if (type === "object") return {};
  return "";
}

export function DocumentEditorPage() {
  const { documentId = "" } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [document, setDocument] = useState<DocumentSummary | null>(null);
  const [values, setValues] = useState<JsonRecord>({});
  const [etag, setEtag] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ path: string; message: string }[] | null>(null);
  const [readOpen, setReadOpen] = useState(false);
  const [published, setPublished] = useState<DocumentSummary | null>(null);
  const [activeSection, setActiveSection] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([api.document(documentId), api.assets()])
      .then(([response, assetItems]) => {
        setDocument(response.data);
        setValues(response.data.content ?? {});
        setEtag(response.etag ?? `"${response.data.controlVersion}"`);
        setAssets(assetItems);
        setDirty(false);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [documentId]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const source = document?.templateSource ?? null;
  const requiredForPublish = useMemo(() => source?.fields.filter((field) => field.requiredAt.includes("publish")) ?? [], [source]);
  const missingRequired = useMemo(() => requiredForPublish.filter((field) => isEmpty(values[field.id])), [requiredForPublish, values]);
  const sections = useMemo(() => source ? collectSections(source.layout) : [], [source]);

  function setValue(fieldId: string, value: unknown) {
    setValues((current) => ({ ...current, [fieldId]: value }));
    setDirty(true);
  }

  function save(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!etag) { resolve(false); return; }
      setSaving(true);
      api.saveDocument(documentId, values, etag, crypto.randomUUID())
        .then((response) => {
          setDocument(response.data);
          setValues(response.data.content ?? values);
          setEtag(response.etag ?? `"${response.data.controlVersion}"`);
          setDirty(false);
          setDiagnostics(null);
          message.success("草稿已保存");
          resolve(true);
        })
        .catch((reason: unknown) => {
          if (reason instanceof ApiError && reason.status === 412) {
            modal.confirm({ title: "保存冲突", content: "文档已被其他会话更新。重新加载会丢弃本地改动。", okText: "重新加载", cancelText: "保留本地", onOk: load });
          } else if (reason instanceof ApiError && Array.isArray(reason.payload.diagnostics)) {
            setDiagnostics(reason.payload.diagnostics as { path: string; message: string }[]);
          } else if (reason instanceof ApiError && reason.code === "ASSET_NOT_READY") {
            message.warning("引用的媒体仍在处理中，请稍后重试");
          } else {
            message.error(reason instanceof Error ? reason.message : "保存失败");
          }
          resolve(false);
        })
        .finally(() => setSaving(false));
    });
  }

  async function publish() {
    setPublishing(true);
    try {
      if (dirty && !(await save())) return;
      const filtered = Object.fromEntries(Object.entries(values).filter(([, value]) => !isEmpty(value)));
      setValues(filtered);
      if (missingRequired.length) {
        setDiagnostics(missingRequired.map((field) => ({ path: field.id, message: `${field.label} 为发布必填` })));
        return;
      }
      await api.publishDocument(documentId);
      message.success("文档已发布，检索投影正在更新");
      load();
    } catch (reason) {
      if (reason instanceof ApiError && Array.isArray(reason.payload.diagnostics)) setDiagnostics(reason.payload.diagnostics as { path: string; message: string }[]);
      else message.error(reason instanceof Error ? reason.message : "发布失败");
    } finally { setPublishing(false); }
  }

  async function openReading() {
    try {
      const response = await api.publishedDocument(documentId);
      setPublished(response.data);
      setReadOpen(true);
    } catch (reason) {
      message.warning(reason instanceof Error ? reason.message : "文档尚未发布");
    }
  }

  if (loading) return <div className="page"><div className="skeleton-card" style={{ height: 300 }} /></div>;
  if (error || !document || !source) return <div className="page"><InlineError message={error || "文档不存在"} onRetry={load} /></div>;

  return (
    <div className="page">
      <div className="breadcrumb"><Button type="link" size="small" icon={<ArrowLeftOutlined />} onClick={() => { if (!dirty || window.confirm("有未保存的改动，确定离开？")) navigate("/documents"); }}>文档列表</Button> / {document.title}</div>
      <header className="page-header">
        <div className="page-icon"><FileTextOutlined /></div>
        <div className="page-heading">
          <h1>{document.title || "未命名文档"}</h1>
          <p>{source.metadata.name} · 控制版本 {document.controlVersion} · 草稿修订 {document.draftGeneration}{dirty ? " · 有未保存改动" : ""}</p>
        </div>
        <div className="page-actions">
          <Button icon={<EyeOutlined />} onClick={() => void openReading()} disabled={!document.publishedRevisionId}>阅读</Button>
          <Button icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存草稿</Button>
          <Button type="primary" icon={<SendOutlined />} loading={publishing} onClick={() => void publish()}>发布</Button>
        </div>
      </header>

      <div className="document-workspace">
        <aside className="document-outline" aria-label="文档结构">
          <div className="pane-title">结构</div>
          {sections.length === 0 ? <div className="property-empty">当前模板没有分组</div> : sections.map((section) => (
            <button type="button" key={section.id} className={`outline-link${activeSection === section.id ? " active" : ""}`} onClick={() => { setActiveSection(section.id); window.document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{section.title || "未命名分组"}</button>
          ))}
          <div className="pane-title" style={{ marginTop: 18 }}>发布检查</div>
          {requiredForPublish.map((field) => (
            <div className="side-kv" key={field.id}><span className="truncate">{field.label}</span><strong>{isEmpty(values[field.id]) ? "待填写" : "已完成"}</strong></div>
          ))}
        </aside>

        <main className="document-paper">
          <h1>{String(values[source.indexing.titleField] || document.title || "未命名文档")}</h1>
          <div className="doc-meta">{source.metadata.description || "发布日期与作者信息将在发布后展示"} · 最近更新 {formatDate(document.updatedAt)}</div>
          <LayoutEditor block={source.layout} fields={source.fields} values={values} setValue={setValue} assets={assets} onAssetCreated={(asset) => setAssets((items) => [asset, ...items])} />
        </main>

        <aside className="document-side">
          <div className="side-block">
            <h3>文档状态</h3>
            <div className="side-kv"><span>状态</span><StatusPill status={document.status} /></div>
            <div className="side-kv"><span>模板</span><strong>{source.metadata.name}</strong></div>
            <div className="side-kv"><span>模板版本</span><strong className="mono">{document.templateVersionId.slice(0, 16)}…</strong></div>
            <div className="side-kv"><span>发布次数</span><strong>{document.publicationGeneration}</strong></div>
          </div>
          <div className="side-block">
            <h3>发布校验</h3>
            {missingRequired.length === 0 ? <Alert type="success" showIcon message="发布必填项已完成" /> : (
              <div className="form-stack">{missingRequired.map((field) => <Tag key={field.id} color="orange">{field.label}</Tag>)}</div>
            )}
          </div>
          <div className="side-block">
            <h3>说明</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>草稿正文只写入 Elasticsearch 的不可变 revision；PostgreSQL 保存版本指针与发布状态。</p>
          </div>
        </aside>
      </div>

      <Modal title="内容校验" open={diagnostics !== null} onCancel={() => setDiagnostics(null)} footer={<Button type="primary" onClick={() => setDiagnostics(null)}>知道了</Button>}>
        {diagnostics?.length ? <div className="form-stack">{diagnostics.map((item, index) => <Alert key={index} type="error" showIcon message={item.path} description={item.message} />)}</div> : <Alert type="success" showIcon message="内容有效" />}
      </Modal>

      <Drawer title="已发布阅读视图" width={720} open={readOpen} onClose={() => setReadOpen(false)}>
        {published && published.templateSource && <ReadingView document={published} />}
      </Drawer>
    </div>
  );
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && !Array.isArray(value) && value !== null && Object.keys(value).length === 0);
}

function collectSections(block: LayoutBlock, out: LayoutBlock[] = []): LayoutBlock[] {
  if (block.kind === "section") out.push(block);
  block.children.forEach((child) => collectSections(child, out));
  return out;
}

function LayoutEditor({
  block,
  fields,
  values,
  setValue,
  assets,
  onAssetCreated,
}: {
  block: LayoutBlock;
  fields: TemplateField[];
  values: JsonRecord;
  setValue: (id: string, value: unknown) => void;
  assets: Asset[];
  onAssetCreated: (asset: Asset) => void;
}) {
  if (block.kind === "section") return <section id={`section-${block.id}`}><div className="section-divider">{block.title || "未命名分组"}</div>{block.children.map((child) => <LayoutEditor key={child.id} block={child} fields={fields} values={values} setValue={setValue} assets={assets} onAssetCreated={onAssetCreated} />)}</section>;
  if (block.kind === "columns") return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>{block.children.map((child) => <LayoutEditor key={child.id} block={child} fields={fields} values={values} setValue={setValue} assets={assets} onAssetCreated={onAssetCreated} />)}</div>;
  if (block.kind === "staticText") return <p className="muted pre-wrap">{block.text}</p>;
  if (block.kind === "stack") return <>{block.children.map((child) => <LayoutEditor key={child.id} block={child} fields={fields} values={values} setValue={setValue} assets={assets} onAssetCreated={onAssetCreated} />)}</>;
  const field = fields.find((item) => item.id === block.fieldId);
  if (!field) return <Alert type="warning" showIcon message="该区块引用的字段已不存在" />;
  if (block.kind === "richText") return <FieldShell field={field}><RichTextEditor value={(values[field.id] as JsonRecord | undefined)} onChange={(value) => setValue(field.id, value)} placeholder={field.placeholder || "开始输入正文…"} /></FieldShell>;
  if (block.kind === "asset") return <FieldShell field={field}><AssetPicker value={typeof values[field.id] === "string" ? String(values[field.id]) : ""} onChange={(value) => setValue(field.id, value)} assets={assets} onAssetCreated={onAssetCreated} /></FieldShell>;
  return <FieldShell field={field}><FieldControl field={field} value={values[field.id]} onChange={(value) => setValue(field.id, value)} /></FieldShell>;
}

function FieldShell({ field, children }: { field: TemplateField; children: React.ReactNode }) {
  return <div className="form-field"><div className="form-field-label">{field.label}{field.requiredAt.includes("publish") && <span className="required-mark">*</span>}</div>{children}{field.help && <div className="form-field-help">{field.help}</div>}</div>;
}

function FieldControl({ field, value, onChange }: { field: TemplateField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "string") return <Input value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "text") return <Input.TextArea rows={3} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "enum") return <Select style={{ width: "100%" }} value={value ? String(value) : undefined} placeholder="请选择" options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))} onChange={onChange} />;
  if (field.type === "array") return <Select mode="tags" style={{ width: "100%" }} value={Array.isArray(value) ? value as string[] : []} placeholder="输入后回车添加" onChange={onChange} />;
  if (field.type === "number") return <InputNumber style={{ width: "100%" }} value={typeof value === "number" ? value : undefined} onChange={onChange} />;
  if (field.type === "boolean") return <Switch checked={Boolean(value)} onChange={onChange} />;
  if (field.type === "date") return <DatePicker style={{ width: "100%" }} value={typeof value === "string" && value ? dayjs(value) : null} onChange={(date) => onChange(date?.format("YYYY-MM-DD") ?? "")} />;
  if (field.type === "object") return <JsonObjectInput value={value} onChange={onChange} />;
  return <Input.TextArea rows={3} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

function JsonObjectInput({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [invalid, setInvalid] = useState(false);
  return <><Input.TextArea rows={5} className="mono" value={text} status={invalid ? "error" : undefined} onChange={(event) => { const next = event.target.value; setText(next); try { onChange(JSON.parse(next)); setInvalid(false); } catch { setInvalid(true); } }} />{invalid && <div className="form-hint" style={{ color: "var(--err)" }}>请输入有效 JSON</div>}</>;
}

function AssetPicker({ value, onChange, assets, onAssetCreated }: { value: string; onChange: (value: string) => void; assets: Asset[]; onAssetCreated: (asset: Asset) => void }) {
  const { message } = App.useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const selected = assets.find((asset) => asset.id === value);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      let asset = (await api.uploadAsset(file)).data;
      onAssetCreated(asset);
      for (let attempt = 0; attempt < 20 && asset.status === "SCANNING"; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        asset = await api.asset(asset.id);
        onAssetCreated(asset);
      }
      if (asset.status !== "READY") throw new Error("媒体未通过校验");
      onChange(asset.id);
      message.success("媒体已上传并选中");
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download() {
    if (!selected) return;
    try {
      const blob = await api.assetBlob(selected.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { message.error(reason instanceof Error ? reason.message : "读取失败"); }
  }

  return (
    <div>
      <input ref={inputRef} type="file" hidden onChange={(event) => void upload(event.target.files)} />
      {!selected ? (
        <div className="asset-slot" role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
          <CloudUploadOutlined style={{ fontSize: 24, color: "var(--accent)" }} />
          <strong style={{ marginTop: 7, color: "var(--text)" }}>{uploading ? "上传并校验中…" : "上传媒体"}</strong>
          <span style={{ marginTop: 2, fontSize: 12 }}>图片会在后台通过 Pillow 校验</span>
        </div>
      ) : (
        <div>
          {selected.mimeType.startsWith("image/") ? <AssetImage assetId={selected.id} alt={selected.originalName} /> : <div className="asset-file"><FileTextOutlined /> <span className="truncate">{selected.originalName}</span></div>}
          <div className="resource-meta"><StatusPill status={selected.status} /><span>{selected.originalName}</span></div>
          <Space wrap style={{ marginTop: 8 }}><Button size="small" onClick={download}>打开</Button><Button size="small" loading={uploading} onClick={() => inputRef.current?.click()}>替换</Button><Button size="small" danger icon={<DeleteOutlined />} onClick={() => onChange("")}>移除</Button></Space>
        </div>
      )}
    </div>
  );
}

function ReadingView({ document }: { document: DocumentSummary }) {
  const source = document.templateSource;
  if (!source) return null;
  const values = document.content ?? {};
  return (
    <article className="document-paper" style={{ border: 0, boxShadow: "none", padding: 0 }}>
      <h1>{String(values[source.indexing.titleField] || document.title)}</h1>
      <div className="doc-meta">已发布 · 第 {document.publicationGeneration} 次发布</div>
      <ReadBlock block={source.layout} fields={source.fields} values={values} />
    </article>
  );
}

function ReadBlock({ block, fields, values }: { block: LayoutBlock; fields: TemplateField[]; values: JsonRecord }) {
  if (block.kind === "section") return <section><div className="section-divider">{block.title}</div>{block.children.map((child) => <ReadBlock key={child.id} block={child} fields={fields} values={values} />)}</section>;
  if (block.kind === "columns") return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>{block.children.map((child) => <ReadBlock key={child.id} block={child} fields={fields} values={values} />)}</div>;
  if (block.kind === "staticText") return <p className="muted pre-wrap">{block.text}</p>;
  if (block.kind === "stack") return <>{block.children.map((child) => <ReadBlock key={child.id} block={child} fields={fields} values={values} />)}</>;
  const field = fields.find((item) => item.id === block.fieldId);
  if (!field) return null;
  const value = values[field.id];
  if (isEmpty(value)) return null;
  if (block.kind === "richText" && typeof value === "object") return <RichRead value={value as JsonRecord} />;
  if (block.kind === "asset" && typeof value === "string") return <AssetImage assetId={value} alt={field.label} />;
  return <div className="form-field"><div className="form-field-label">{field.label}</div><div className="pre-wrap">{Array.isArray(value) ? value.join("、") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</div></div>;
}

function RichRead({ value }: { value: JsonRecord }) {
  const render = (node: JsonRecord): React.ReactNode => {
    const type = String(node.type ?? "");
    const children = Array.isArray(node.content) ? (node.content as JsonRecord[]).map((child, index) => <span key={index}>{render(child)}</span>) : null;
    if (type === "text") return String(node.text ?? "");
    if (type === "paragraph") return <p>{children}</p>;
    if (type === "heading") return <h2>{children}</h2>;
    if (type === "bulletList") return <ul>{children}</ul>;
    if (type === "orderedList") return <ol>{children}</ol>;
    if (type === "listItem") return <li>{children}</li>;
    if (type === "blockquote") return <blockquote>{children}</blockquote>;
    if (type === "hardBreak") return <br />;
    return <>{children}</>;
  };
  return <div className="rich-content" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>{render(value)}</div>;
}
