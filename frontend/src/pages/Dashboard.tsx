import { useEffect, useState } from "react";
import { Button } from "antd";
import {
  ArrowRightOutlined,
  CloudUploadOutlined,
  FileAddOutlined,
  FileTextOutlined,
  LayoutOutlined,
  ReadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { EmptyState, formatDate, InlineError, LoadingCards, PageHeader, StatusPill } from "../components/Common";
import type { Asset, DocumentSummary, TemplateSummary } from "../types";

export function DashboardPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<{ loading: boolean; error: string; templates: TemplateSummary[]; documents: DocumentSummary[]; assets: Asset[] }>({
    loading: true,
    error: "",
    templates: [],
    documents: [],
    assets: [],
  });

  const load = () => {
    setState((value) => ({ ...value, loading: true, error: "" }));
    Promise.all([api.templates(), api.documents(), api.assets()])
      .then(([templates, documents, assets]) => setState({ loading: false, error: "", templates, documents, assets }))
      .catch((error: Error) => setState((value) => ({ ...value, loading: false, error: error.message })));
  };

  useEffect(load, []);

  const published = state.documents.filter((item) => item.status === "published").length;
  return (
    <div className="page">
      <PageHeader
        icon={<ReadOutlined />}
        title="内容工作台"
        description="从模板编排到审核发布，集中管理可检索的结构化内容。"
        actions={<Button type="primary" icon={<FileAddOutlined />} onClick={() => navigate("/documents?create=1")}>新建文档</Button>}
      />

      {state.error ? <InlineError message={state.error} onRetry={load} /> : (
        <>
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-label">模板</div><div className="stat-value">{state.templates.length}</div><div className="stat-foot">{state.templates.filter((item) => item.status === "published").length} 个已发布</div></div>
            <div className="stat-card"><div className="stat-label">文档</div><div className="stat-value">{state.documents.length}</div><div className="stat-foot">{published} 个已发布</div></div>
            <div className="stat-card"><div className="stat-label">媒体资产</div><div className="stat-value">{state.assets.length}</div><div className="stat-foot">{state.assets.filter((item) => item.status === "READY").length} 个可用</div></div>
            <div className="stat-card"><div className="stat-label">内容状态</div><div className="stat-value">{state.documents.length ? Math.round((published / state.documents.length) * 100) : 0}%</div><div className="stat-foot">发布完成率</div></div>
          </div>

          <section className="section-card">
            <div className="section-head"><div><h2>快速开始</h2><p>常用操作保持在一次点击内。</p></div></div>
            <div className="quick-grid">
              <div className="quick-item" role="button" tabIndex={0} onClick={() => navigate("/templates")}>
                <div className="quick-icon"><LayoutOutlined /></div>
                <div><strong>设计模板</strong><span>拖拽区块与字段，发布不可变版本</span></div>
              </div>
              <div className="quick-item" role="button" tabIndex={0} onClick={() => navigate("/documents?create=1")}>
                <div className="quick-icon"><FileTextOutlined /></div>
                <div><strong>创建文档</strong><span>按已发布模板开始结构化采编</span></div>
              </div>
              <div className="quick-item" role="button" tabIndex={0} onClick={() => navigate("/assets")}>
                <div className="quick-icon"><CloudUploadOutlined /></div>
                <div><strong>上传媒体</strong><span>经 PyUploadX 统一存储与校验</span></div>
              </div>
            </div>
          </section>

          <section className="section-card">
            <div className="section-head">
              <div><h2>最近文档</h2><p>按更新时间排序，点击继续编辑。</p></div>
              <div className="toolbar-spacer" />
              <Button type="text" onClick={() => navigate("/documents")}>全部文档 <ArrowRightOutlined /></Button>
            </div>
            {state.loading ? <LoadingCards count={3} /> : state.documents.length === 0 ? (
              <EmptyState title="还没有文档" description="先发布一个模板，再创建第一篇结构化内容。" action={<Button type="primary" onClick={() => navigate("/templates")}>前往模板</Button>} />
            ) : (
              <div className="card-grid">
                {state.documents.slice(0, 6).map((document) => (
                  <article className="resource-card" role="button" tabIndex={0} key={document.id} onClick={() => navigate(`/documents/${document.id}`)}>
                    <div className="resource-card-top"><div className="resource-mark"><FileTextOutlined /></div><div className="resource-title">{document.title}</div><StatusPill status={document.status} /></div>
                    <div className="resource-desc">模板：{document.templateName || "未知模板"}</div>
                    <div className="resource-meta"><span>{formatDate(document.updatedAt)}</span><span>修订 {document.draftGeneration}</span></div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="section-card">
            <div className="section-head">
              <div><h2>检索入口</h2><p>已发布内容由 Elasticsearch 提供中文全文检索。</p></div>
              <div className="toolbar-spacer" />
              <Button icon={<SearchOutlined />} onClick={() => navigate("/search")}>打开检索</Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
