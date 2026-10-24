import { useState } from "react";
import { Button, Input } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { EmptyState, HighlightText, PageHeader } from "../components/Common";
import type { SearchHit } from "../types";

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run(value = query) {
    setLoading(true);
    setError("");
    try {
      const result = await api.search(value.trim());
      setItems(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "检索失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <PageHeader icon={<SearchOutlined />} title="内容检索" description="仅检索当前租户的已发布投影，支持中文分词与标题加权。" />
      <section className="search-hero">
        <h2>查找已发布内容</h2>
        <p>输入标题、摘要或正文关键词；草稿和未授权内容不会出现在结果中。</p>
        <div className="search-input">
          <Input.Search
            size="large"
            allowClear
            enterButton={loading ? "检索中…" : "检索"}
            placeholder="例如：安装步骤、故障排查、数据导出"
            value={query}
            loading={loading}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={(value) => void run(value)}
          />
        </div>
      </section>

      {error && <div className="section-card"><EmptyState title="检索服务不可用" description={error} action={<Button onClick={() => void run()}>重试</Button>} /></div>}
      {!error && items === null && <div className="section-card"><EmptyState icon={<SearchOutlined />} title="开始检索" description="输入关键词后，命中内容会显示标题、摘要与高亮片段。" /></div>}
      {!error && items !== null && items.length === 0 && <div className="section-card"><EmptyState title="没有找到匹配内容" description={query ? `没有与“${query}”匹配的已发布文档。` : "当前租户还没有已发布文档。"} action={<Button onClick={() => { setQuery(""); setItems(null); }}>清除关键词</Button>} /></div>}
      {items !== null && items.length > 0 && (
        <div>
          <div className="toolbar"><span className="toolbar-count">找到 {items.length} 条结果</span></div>
          {items.map((item) => {
            const title = item.highlight.title?.[0] ?? item.title;
            const summary = item.highlight.summary?.[0] ?? item.highlight.fullText?.[0] ?? item.summary;
            return (
              <article className="search-result" role="button" tabIndex={0} key={item.documentId} onClick={() => navigate(`/documents/${item.documentId}`)}>
                <h3><HighlightText value={title || "未命名文档"} /></h3>
                <p><HighlightText value={summary || "无摘要"} /></p>
                <div className="result-meta"><span>相关度 {item.score?.toFixed(2) ?? "—"}</span><span className="mono">{item.documentId}</span></div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
