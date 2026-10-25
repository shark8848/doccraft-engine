import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { App as AntApp, ConfigProvider, theme as antTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppstoreOutlined,
  BgColorsOutlined,
  BookOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  LayoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { api } from "./api";
import { AssetsPage } from "./pages/Assets";
import { DashboardPage } from "./pages/Dashboard";
import { DataSourcesPage } from "./pages/DataSources";
import { DocumentEditorPage } from "./pages/DocumentEditor";
import { DocumentsPage } from "./pages/Documents";
import { SearchPage } from "./pages/Search";
import { TemplateEditorPage } from "./pages/TemplateEditor";
import { TemplatesPage } from "./pages/Templates";
import type { SessionInfo } from "./types";
import "./styles.css";

type ThemeName = "light" | "dark" | "high-contrast" | "green";
const THEME_KEY = "doccraft.theme";
const COLLAPSE_KEY = "doccraft.sidebarCollapsed";
const ThemeContext = createContext<{ theme: ThemeName; setTheme: (theme: ThemeName) => void }>({ theme: "light", setTheme: () => undefined });

const NAV_GROUPS = [
  {
    label: "工作台",
    items: [
      { path: "/", label: "概览", icon: <AppstoreOutlined /> },
      { path: "/templates", label: "模板", icon: <LayoutOutlined /> },
      { path: "/documents", label: "文档", icon: <FileTextOutlined /> },
      { path: "/search", label: "检索", icon: <SearchOutlined /> },
    ],
  },
  {
    label: "资源",
    items: [
      { path: "/assets", label: "媒体库", icon: <CloudUploadOutlined /> },
      { path: "/data-sources", label: "数据源", icon: <DatabaseOutlined /> },
    ],
  },
];

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "true");
  const { theme: themeName, setTheme: setThemeName } = useContext(ThemeContext);
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    void api.session().then(setSession).catch(() => setSession(null));
  }, []);

  const currentRoot = useMemo(() => {
    if (location.pathname.startsWith("/templates")) return "/templates";
    if (location.pathname.startsWith("/documents")) return "/documents";
    if (location.pathname.startsWith("/assets")) return "/assets";
    if (location.pathname.startsWith("/data-sources")) return "/data-sources";
    if (location.pathname.startsWith("/search")) return "/search";
    return "/";
  }, [location.pathname]);

  const isEditor = location.pathname.startsWith("/templates/") || location.pathname.startsWith("/documents/");
  const themeIcon = themeName === "light" ? <SunOutlined /> : themeName === "dark" ? <MoonOutlined /> : <BgColorsOutlined />;
  const nextTheme: ThemeName = themeName === "light" ? "dark" : themeName === "dark" ? "green" : themeName === "green" ? "high-contrast" : "light";

  return (
    <div className={`layout${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="layout-sidebar">
        <div className="brand">
          <div className="brand-logo">DC</div>
          <div className="brand-copy">
            <div className="brand-name">DocCraft</div>
            <div className="brand-sub">内容工程台</div>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={collapsed ? "展开左侧导航栏" : "收起左侧导航栏"}
            title={collapsed ? "展开左侧导航栏" : "收起左侧导航栏"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>

        {NAV_GROUPS.map((group) => (
          <nav className="nav-section" key={group.label} aria-label={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((item) => (
              <div
                key={item.path}
                role="button"
                tabIndex={0}
                className={`nav-item${currentRoot === item.path ? " active" : ""}`}
                onClick={() => navigate(item.path)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(item.path);
                  }
                }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </div>
            ))}
          </nav>
        ))}

        <div className="sidebar-footer">
          <div className="theme-row">
            <span className="theme-label">显示样式</span>
            <div className="theme-options">
              <button
                type="button"
                className="theme-option active"
                title={`切换主题（当前 ${themeName}）`}
                aria-label={`切换主题（当前 ${themeName}）`}
                onClick={() => setThemeName(nextTheme)}
              >
                {themeIcon}
              </button>
            </div>
          </div>
          <div className="sidebar-meta">
            <span>v{session?.version ?? "—"}</span>
            <span><span className={`status-dot${session ? "" : " off"}`} />{session ? "API 在线" : "API 未就绪"}</span>
          </div>
        </div>
      </aside>

      <main className={`layout-main${isEditor ? " is-editor" : ""}`}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:documentId" element={<DocumentEditorPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/data-sources" element={<DataSourcesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [themeName, setTheme] = useState<ThemeName>(() => (localStorage.getItem(THEME_KEY) as ThemeName) || "light");
  useEffect(() => {
    document.documentElement.dataset.theme = themeName;
    localStorage.setItem(THEME_KEY, themeName);
  }, [themeName]);
  const dark = themeName === "dark" || themeName === "high-contrast";
  return (
    <ThemeContext.Provider value={{ theme: themeName, setTheme }}>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: themeName === "high-contrast" ? "#ffb400" : themeName === "green" ? "#2e7d32" : themeName === "dark" ? "#22c978" : "#07c05f",
          borderRadius: 8,
          fontSize: 14,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif',
          colorBgContainer: dark ? "#171e27" : themeName === "green" ? "#f6faf4" : "#ffffff",
          colorBgLayout: dark ? "#10151c" : themeName === "green" ? "#e8f0e6" : "#f5f7fa",
        },
      }}
    >
      <AntApp>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AntApp>
    </ConfigProvider>
    </ThemeContext.Provider>
  );
}
