import { useEffect, useState } from "react";
import { App, Button, Drawer, Form, Input, Modal, Space, Switch, Table, Tag } from "antd";
import { DatabaseOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import { api } from "../api";
import { EmptyState, formatDate, InlineError, PageHeader } from "../components/Common";
import type { OptionItem, OptionSource, OptionSourcePayload } from "../types";

interface SourceFormValues {
  name: string;
  description: string;
  enabled: boolean;
  tableName: string;
  valueColumn: string;
  labelColumn: string;
  searchColumns: string;
  activeColumn: string;
  orderBy: string;
}

const EMPTY_FORM: SourceFormValues = {
  name: "",
  description: "",
  enabled: true,
  tableName: "",
  valueColumn: "",
  labelColumn: "",
  searchColumns: "",
  activeColumn: "",
  orderBy: "",
};

function splitColumns(value: string): string[] {
  return Array.from(new Set(value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)));
}

function payloadFromForm(values: SourceFormValues): OptionSourcePayload {
  return {
    name: values.name.trim(),
    description: values.description?.trim() ?? "",
    enabled: values.enabled,
    tableName: values.tableName.trim(),
    valueColumn: values.valueColumn.trim(),
    labelColumn: values.labelColumn.trim(),
    searchColumns: splitColumns(values.searchColumns ?? ""),
    activeColumn: values.activeColumn?.trim() ?? "",
    orderBy: splitColumns(values.orderBy ?? ""),
  };
}

export function DataSourcesPage() {
  const { message } = App.useApp();
  const [sources, setSources] = useState<OptionSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OptionSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<OptionSource | null>(null);
  const [previewItems, setPreviewItems] = useState<OptionItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form] = Form.useForm<SourceFormValues>();

  const load = () => {
    setLoading(true);
    setError("");
    api.optionSources()
      .then(setSources)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(source: OptionSource) {
    setEditing(source);
    form.setFieldsValue({
      name: source.name,
      description: source.description,
      enabled: source.enabled,
      tableName: source.tableName,
      valueColumn: source.valueColumn,
      labelColumn: source.labelColumn,
      searchColumns: source.searchColumns.join(", "),
      activeColumn: source.activeColumn,
      orderBy: source.orderBy.join(", "),
    });
    setOpen(true);
  }

  async function save() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) await api.updateOptionSource(editing.id, payloadFromForm(values));
      else await api.createOptionSource(payloadFromForm(values));
      message.success(editing ? "数据源已更新" : "数据源已创建");
      setOpen(false);
      load();
    } catch (reason) {
      if (reason instanceof Error) message.error(reason.message);
    } finally {
      setSaving(false);
    }
  }

  async function showOptions(source: OptionSource) {
    setPreview(source);
    setPreviewItems([]);
    setPreviewLoading(true);
    try {
      setPreviewItems(await api.optionItems(source.id, "", 20));
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : "读取选项失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        icon={<DatabaseOutlined />}
        title="数据源"
        description="登记业务表与值、显示、搜索字段；模板单选字段可引用这里的数据源。"
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建数据源</Button>
          </>
        }
      />

      {loading ? <div className="skeleton-card" style={{ height: 260 }} /> : error ? <InlineError message={error} onRetry={load} /> : sources.length === 0 ? (
        <EmptyState
          icon={<DatabaseOutlined />}
          title="还没有数据源"
          description="先登记一个以 biz_ 开头的业务表，再在模板字段中绑定。"
          action={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建数据源</Button>}
        />
      ) : (
        <section className="section-card">
          <Table
            rowKey="id"
            dataSource={sources}
            pagination={false}
            scroll={{ x: 920 }}
            columns={[
              {
                title: "名称",
                dataIndex: "name",
                width: 190,
                render: (value: string, record) => <div><strong>{value}</strong><div className="muted" style={{ fontSize: 11 }}>{record.description || "未填写说明"}</div></div>,
              },
              { title: "业务表", dataIndex: "tableName", width: 180, render: (value: string) => <code>{value}</code> },
              { title: "值 / 显示字段", width: 180, render: (_, record) => <span><code>{record.valueColumn}</code> / <code>{record.labelColumn}</code></span> },
              { title: "搜索字段", dataIndex: "searchColumns", width: 180, render: (value: string[]) => value.length ? value.join(", ") : "—" },
              { title: "状态", dataIndex: "enabled", width: 90, render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "启用" : "停用"}</Tag> },
              { title: "更新时间", dataIndex: "updatedAt", width: 130, render: (value: string) => formatDate(value) },
              {
                title: "操作",
                fixed: "right",
                width: 150,
                render: (_, record) => (
                  <Space>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => void showOptions(record)}>选项</Button>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
                  </Space>
                ),
              },
            ]}
          />
        </section>
      )}

      <Modal
        title={editing ? "编辑数据源" : "新建数据源"}
        open={open}
        width={640}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_FORM}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }, { max: 200 }]}>
            <Input placeholder="例如：浙江省地市" />
          </Form.Item>
          <Form.Item name="description" label="说明" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} placeholder="说明数据来源和适用范围" />
          </Form.Item>
          <Form.Item name="tableName" label="业务表" rules={[{ required: true, message: "请输入业务表" }]} extra="仅允许 biz_ 开头的业务表">
            <Input className="mono" placeholder="biz_region_city" />
          </Form.Item>
          <div className="table-size-fields">
            <Form.Item name="valueColumn" label="值字段" rules={[{ required: true, message: "请输入值字段" }]}>
              <Input className="mono" placeholder="city_code" />
            </Form.Item>
            <Form.Item name="labelColumn" label="显示字段" rules={[{ required: true, message: "请输入显示字段" }]}>
              <Input className="mono" placeholder="city_name" />
            </Form.Item>
          </div>
          <Form.Item name="searchColumns" label="搜索字段" extra="多个字段用逗号分隔">
            <Input className="mono" placeholder="city_name, city_code" />
          </Form.Item>
          <div className="table-size-fields">
            <Form.Item name="activeColumn" label="启用字段" extra="可留空">
              <Input className="mono" placeholder="enabled" />
            </Form.Item>
            <Form.Item name="orderBy" label="排序字段" extra="多个字段用逗号分隔">
              <Input className="mono" placeholder="sort_order, city_code" />
            </Form.Item>
          </div>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title={preview ? `数据源选项 · ${preview.name}` : "数据源选项"} width={380} open={preview !== null} onClose={() => setPreview(null)}>
        {previewLoading ? <div className="skeleton-card" style={{ height: 160 }} /> : previewItems.length === 0 ? (
          <EmptyState title="暂无选项" description="检查业务表、启用条件和字段配置。" />
        ) : (
          <div className="form-stack">
            <div className="form-hint">显示前 {previewItems.length} 项</div>
            {previewItems.map((item) => (
              <div className="side-kv" key={item.value}><span className="mono">{item.value}</span><strong>{item.label}</strong></div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
