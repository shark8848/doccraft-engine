import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Segmented } from "antd";
import { FileAddOutlined, LayoutOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { EmptyState, formatDate, InlineError, LoadingCards, PageHeader, StatusPill } from "../components/Common";
import { starterTemplate } from "../templateDefaults";
import type { TemplateSummary } from "../types";

export function TemplatesPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [items, setItems] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ name: string; description: string }>();

  const load = () => {
    setLoading(true);
    setError("");
    api.templates()
      .then(setItems)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = items.filter((item) => {
    const matchesQuery = `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || item.status === filter;
    return matchesQuery && matchesFilter;
  });

  async function create() {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const source = starterTemplate(values.name.trim(), values.description?.trim() ?? "");
      const result = await api.createTemplate(source);
      message.success("模板已创建");
      setOpen(false);
      form.resetFields();
      navigate(`/templates/${result.data.id}`);
    } catch (reason) {
      if (reason instanceof Error) message.error(reason.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        icon={<LayoutOutlined />}
        title="模板"
        description="以结构化区块编排字段与阅读顺序，发布后成为不可变版本。"
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建模板</Button>
          </>
        }
      />

      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as typeof filter)}
          options={[{ label: "全部", value: "all" }, { label: "已发布", value: "published" }, { label: "草稿", value: "draft" }]}
        />
        <div className="toolbar-spacer" />
        <span className="toolbar-count">{filtered.length} 个模板</span>
        <Input.Search allowClear placeholder="搜索模板名称或说明" style={{ width: 260 }} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {loading ? <LoadingCards /> : error ? <InlineError message={error} onRetry={load} /> : filtered.length === 0 ? (
        <EmptyState
          icon={<LayoutOutlined />}
          title={query ? "没有匹配的模板" : "还没有模板"}
          description={query ? "尝试更换关键词或清除筛选。" : "从示例骨架开始，拖拽区块、字段和富文本槽位。"}
          action={query ? <Button onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</Button> : <Button type="primary" icon={<FileAddOutlined />} onClick={() => setOpen(true)}>新建模板</Button>}
        />
      ) : (
        <div className="card-grid">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="resource-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/templates/${item.id}`)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(`/templates/${item.id}`); } }}
            >
              <div className="resource-card-top">
                <div className="resource-mark"><LayoutOutlined /></div>
                <div className="resource-title">{item.name}</div>
                <StatusPill status={item.status} />
              </div>
              <div className="resource-desc">{item.description || "未填写模板说明"}</div>
              <div className="resource-meta"><span>控制版本 {item.controlVersion}</span><span>{formatDate(item.updatedAt)}</span></div>
            </article>
          ))}
        </div>
      )}

      <Modal title="新建模板" open={open} okText="创建并编辑" cancelText="取消" confirmLoading={creating} onOk={() => void create()} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical" initialValues={{ name: "未命名模板", description: "" }}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: "请输入模板名称" }, { max: 200 }]}>
            <Input placeholder="例如：产品操作手册" />
          </Form.Item>
          <Form.Item name="description" label="说明" rules={[{ max: 500 }]}>
            <Input.TextArea rows={3} placeholder="说明适用场景、读者和内容边界" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
