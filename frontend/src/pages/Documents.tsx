import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Segmented, Select } from "antd";
import { FileAddOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { EmptyState, formatDate, InlineError, LoadingCards, PageHeader, StatusPill } from "../components/Common";
import type { DocumentSummary, TemplateSummary } from "../types";

export function DocumentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message } = App.useApp();
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ templateId: string; title: string }>();

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([api.documents(), api.templates()])
      .then(([documents, allTemplates]) => {
        setItems(documents);
        setTemplates(allTemplates.filter((item) => item.status === "published"));
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    if (searchParams.get("create") === "1") setOpen(true);
  }, [searchParams]);

  const filtered = items.filter((item) => {
    const matchesQuery = `${item.title} ${item.templateName}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (filter === "all" || item.status === filter);
  });

  async function create() {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const result = await api.createDocument(values.templateId, values.title.trim());
      message.success("文档已创建");
      setOpen(false);
      form.resetFields();
      navigate(`/documents/${result.data.id}`);
    } catch (reason) {
      if (reason instanceof Error) message.error(reason.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        icon={<FileTextOutlined />}
        title="文档"
        description="按模板版本采编草稿，发布时完成阶段必填校验与检索投影。"
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建文档</Button>
          </>
        }
      />

      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as typeof filter)}
          options={[{ label: "全部", value: "all" }, { label: "草稿", value: "draft" }, { label: "已发布", value: "published" }]}
        />
        <div className="toolbar-spacer" />
        <span className="toolbar-count">{filtered.length} 篇文档</span>
        <Input.Search allowClear placeholder="搜索标题或模板" style={{ width: 260 }} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {loading ? <LoadingCards /> : error ? <InlineError message={error} onRetry={load} /> : filtered.length === 0 ? (
        <EmptyState
          icon={<FileTextOutlined />}
          title={query ? "没有匹配的文档" : "还没有文档"}
          description={query ? "尝试更换关键词或清除筛选。" : templates.length ? "选择一个已发布模板，创建并开始采编。" : "需要先发布一个模板，才能创建文档。"}
          action={query ? <Button onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</Button> : templates.length ? <Button type="primary" icon={<FileAddOutlined />} onClick={() => setOpen(true)}>新建文档</Button> : <Button type="primary" onClick={() => navigate("/templates")}>前往模板</Button>}
        />
      ) : (
        <div className="card-grid">
          {filtered.map((item) => (
            <article
              className="resource-card"
              role="button"
              tabIndex={0}
              key={item.id}
              onClick={() => navigate(`/documents/${item.id}`)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(`/documents/${item.id}`); } }}
            >
              <div className="resource-card-top">
                <div className="resource-mark"><FileTextOutlined /></div>
                <div className="resource-title">{item.title}</div>
                <StatusPill status={item.status} />
              </div>
              <div className="resource-desc">模板：{item.templateName || "未知模板"}</div>
              <div className="resource-meta"><span>草稿修订 {item.draftGeneration}</span><span>发布 {item.publicationGeneration}</span><span>{formatDate(item.updatedAt)}</span></div>
            </article>
          ))}
        </div>
      )}

      <Modal title="新建文档" open={open} okText="创建并编辑" cancelText="取消" confirmLoading={creating} onOk={() => void create()} onCancel={() => setOpen(false)}>
        {templates.length === 0 ? (
          <EmptyState title="没有可用模板" description="只有已发布模板才能创建文档。" action={<Button type="primary" onClick={() => { setOpen(false); navigate("/templates"); }}>前往模板</Button>} />
        ) : (
          <Form form={form} layout="vertical" initialValues={{ templateId: templates[0]?.id }}>
            <Form.Item name="templateId" label="模板" rules={[{ required: true, message: "请选择模板" }]}>
              <Select options={templates.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
            <Form.Item name="title" label="文档标题" rules={[{ required: true, message: "请输入标题" }, { max: 300 }]}>
              <Input placeholder="先写一个清晰的标题，稍后可修改" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
