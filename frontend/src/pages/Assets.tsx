import { useEffect, useRef, useState } from "react";
import { App, Button, Drawer, Input, Segmented } from "antd";
import { CloudUploadOutlined, FileOutlined, ReloadOutlined } from "@ant-design/icons";

import { api } from "../api";
import { AssetImage, EmptyState, formatBytes, formatDate, InlineError, LoadingCards, PageHeader, StatusPill } from "../components/Common";
import type { Asset } from "../types";

export function AssetsPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "image" | "document">("all");
  const [selected, setSelected] = useState<Asset | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    api.assets()
      .then((assets) => { setItems(assets); setError(""); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!items.some((item) => item.status === "SCANNING")) return;
    const timer = window.setInterval(() => load(true), 2500);
    return () => window.clearInterval(timer);
  }, [items]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let succeeded = 0;
    for (const file of Array.from(files)) {
      try {
        await api.uploadAsset(file);
        succeeded += 1;
      } catch (reason) {
        message.error(`${file.name}: ${reason instanceof Error ? reason.message : "上传失败"}`);
      }
    }
    if (succeeded) message.success(`已上传 ${succeeded} 个文件，正在校验`);
    setUploading(false);
    load(true);
  }

  const filtered = items.filter((item) => {
    const matchesQuery = `${item.originalName} ${item.mimeType}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all" || (filter === "image" ? item.mimeType.startsWith("image/") : !item.mimeType.startsWith("image/"));
    return matchesQuery && matchesFilter;
  });

  return (
    <div className="page">
      <PageHeader
        icon={<CloudUploadOutlined />}
        title="媒体库"
        description="文件统一经 PyUploadX 保存；图片通过 Pillow 校验后才可供文档引用。"
        actions={<><Button icon={<ReloadOutlined />} onClick={() => load()}>刷新</Button><Button type="primary" icon={<CloudUploadOutlined />} loading={uploading} onClick={() => inputRef.current?.click()}>上传文件</Button></>}
      />

      <input ref={inputRef} type="file" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} />
      <div
        className="upload-dragger"
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void uploadFiles(event.dataTransfer.files); }}
      >
        <CloudUploadOutlined style={{ fontSize: 28, color: "var(--accent)" }} />
        <strong style={{ marginTop: 8, color: "var(--text)" }}>{uploading ? "正在上传…" : "拖入文件，或点击选择"}</strong>
        <span style={{ marginTop: 3, fontSize: 12 }}>支持图片、PDF、音视频与文本，单文件不超过 50 MB</span>
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <Segmented value={filter} onChange={(value) => setFilter(value as typeof filter)} options={[{ label: "全部", value: "all" }, { label: "图片", value: "image" }, { label: "文件", value: "document" }]} />
        <div className="toolbar-spacer" />
        <span className="toolbar-count">{filtered.length} 个资源</span>
        <Input.Search allowClear placeholder="搜索文件名或类型" style={{ width: 260 }} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {loading ? <LoadingCards /> : error ? <InlineError message={error} onRetry={() => load()} /> : filtered.length === 0 ? (
        <EmptyState icon={<CloudUploadOutlined />} title={query ? "没有匹配的资源" : "媒体库为空"} description={query ? "尝试更换关键词或清除筛选。" : "上传图片、附件或音视频，文档通过 assetId 引用。"} action={query ? <Button onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</Button> : undefined} />
      ) : (
        <div className="card-grid">
          {filtered.map((asset) => (
            <article className="resource-card" role="button" tabIndex={0} key={asset.id} onClick={() => setSelected(asset)}>
              <div className={`asset-thumb${asset.status === "SCANNING" ? " pending" : ""}`}>
                {asset.mimeType.startsWith("image/") && asset.status === "READY" ? <AssetImage assetId={asset.id} alt={asset.originalName} /> : <FileOutlined style={{ fontSize: 30 }} />}
              </div>
              <div className="resource-card-top"><div className="resource-title" title={asset.originalName}>{asset.originalName}</div><StatusPill status={asset.status} /></div>
              <div className="resource-meta"><span>{formatBytes(asset.sizeBytes)}</span><span>{formatDate(asset.createdAt)}</span></div>
            </article>
          ))}
        </div>
      )}

      <Drawer title="资源详情" width={360} open={selected !== null} onClose={() => setSelected(null)}>
        {selected && (
          <div className="form-stack">
            {selected.mimeType.startsWith("image/") && selected.status === "READY" && <AssetImage assetId={selected.id} alt={selected.originalName} />}
            <div className="side-kv"><span>文件</span><strong className="truncate">{selected.originalName}</strong></div>
            <div className="side-kv"><span>类型</span><strong>{selected.mimeType}</strong></div>
            <div className="side-kv"><span>大小</span><strong>{formatBytes(selected.sizeBytes)}</strong></div>
            <div className="side-kv"><span>状态</span><StatusPill status={selected.status} /></div>
            <div className="side-kv"><span>资产 ID</span><strong className="mono">{selected.id}</strong></div>
            <div className="side-kv"><span>对象键</span><strong className="mono truncate" title={selected.objectKey}>{selected.objectKey}</strong></div>
            <div className="side-kv"><span>SHA-256</span><strong className="mono truncate" title={selected.sha256}>{selected.sha256}</strong></div>
            {selected.errorMessage && <div className="status-pill err">{selected.errorMessage}</div>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
