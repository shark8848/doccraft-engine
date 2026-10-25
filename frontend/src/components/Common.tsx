import { useEffect, useState, type ReactNode } from "react";
import { Button, Spin } from "antd";
import { InboxOutlined } from "@ant-design/icons";

import { api } from "../api";

export function PageHeader({
  icon,
  title,
  description,
  actions,
  breadcrumb,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <>
      {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
      <header className="page-header">
        <div className="page-icon">{icon}</div>
        <div className="page-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
    </>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <InboxOutlined />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}

export function LoadingCards({ count = 6 }: { count?: number }) {
  return (
    <div className="card-grid" aria-label="加载中">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized === "published" || normalized === "ready"
    ? "ok"
    : normalized === "draft" || normalized === "scanning"
      ? "info"
      : normalized === "quarantined" || normalized === "failed"
        ? "err"
        : "warn";
  const labels: Record<string, string> = {
    published: "已发布",
    draft: "草稿",
    ready: "可用",
    scanning: "校验中",
    quarantined: "已隔离",
    failed: "失败",
  };
  return <span className={`status-pill ${tone}`}>{labels[normalized] ?? status}</span>;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function HighlightText({ value }: { value: string }) {
  const parts = value.split(/(<em>|<\/em>)/g);
  let active = false;
  return (
    <>
      {parts.map((part, index) => {
        if (part === "<em>") { active = true; return null; }
        if (part === "</em>") { active = false; return null; }
        return active ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function AssetImage({ assetId, alt, className, inline = false }: { assetId: string; alt: string; className?: string; inline?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void api.assetBlob(assetId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  if (failed) return inline ? <span className="rich-image-status">资源尚未就绪</span> : <div className="asset-slot">资源尚未就绪</div>;
  if (!url) return inline ? <span className="rich-image-status"><Spin size="small" /> 加载图片…</span> : <div className="asset-slot"><Spin size="small" /> <span style={{ marginTop: 8 }}>加载资源…</span></div>;
  return <img className={className ?? (inline ? "rich-inline-image" : "asset-preview")} src={url} alt={alt} />;
}

export function Panel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="section-card">
      <div className="section-head">
        <h2>{title}</h2>
        <div className="toolbar-spacer" />
        {extra}
      </div>
      {children}
    </section>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="暂时无法加载"
      description={message}
      action={onRetry ? <Button onClick={onRetry}>重新加载</Button> : undefined}
    />
  );
}
