import type {
  Asset,
  DocumentSummary,
  JsonRecord,
  OptionItem,
  OptionSource,
  OptionSourcePayload,
  SearchHit,
  SessionInfo,
  TemplateDetail,
  TemplateSource,
  TemplateSummary,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";
const AUTH_HEADERS: Record<string, string> = {
  ...(import.meta.env.VITE_DOCCRAFT_USER ? { "X-DocCraft-User": import.meta.env.VITE_DOCCRAFT_USER } : {}),
  ...(import.meta.env.VITE_DOCCRAFT_TENANT ? { "X-DocCraft-Tenant": import.meta.env.VITE_DOCCRAFT_TENANT } : {}),
  ...(import.meta.env.VITE_DOCCRAFT_ROLE ? { "X-DocCraft-Role": import.meta.env.VITE_DOCCRAFT_ROLE } : {}),
};

export class ApiError extends Error {
  status: number;
  code: string;
  payload: JsonRecord;

  constructor(status: number, payload: JsonRecord) {
    super(String(payload.message ?? payload.detail ?? `请求失败 (${status})`));
    this.status = status;
    this.code = String(payload.code ?? "REQUEST_FAILED");
    this.payload = payload;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  rawBody?: BodyInit;
}

export interface ApiResponse<T> {
  data: T;
  etag: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  for (const [key, value] of Object.entries(AUTH_HEADERS)) headers.set(key, value);
  let body = options.rawBody;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, body });
  if (!response.ok) {
    let payload: JsonRecord = {};
    try {
      const parsed = (await response.json()) as JsonRecord;
      payload = typeof parsed.detail === "object" && parsed.detail !== null
        ? (parsed.detail as JsonRecord)
        : parsed;
    } catch {
      payload = { message: await response.text().catch(() => response.statusText) };
    }
    throw new ApiError(response.status, payload);
  }
  if (response.status === 204) return { data: undefined as T, etag: response.headers.get("ETag") };
  const data = (await response.json()) as T;
  return { data, etag: response.headers.get("ETag") };
}

export const api = {
  session: async () => (await request<SessionInfo>("/session")).data,
  templates: async () => (await request<{ items: TemplateSummary[] }>("/templates")).data.items,
  template: async (id: string) => request<TemplateDetail>(`/templates/${id}`),
  createTemplate: async (source: TemplateSource) =>
    request<TemplateDetail>("/templates", { method: "POST", body: { source } }),
  saveTemplate: async (id: string, source: TemplateSource, etag: string) =>
    request<TemplateDetail>(`/templates/${id}/draft`, {
      method: "PUT",
      headers: { "If-Match": etag },
      body: { source },
    }),
  validateTemplate: async (id: string, source: TemplateSource) =>
    (await request<{ valid: boolean; compiled: JsonRecord }>(`/templates/${id}/validate`, {
      method: "POST",
      body: { source },
    })).data,
  publishTemplate: async (id: string) =>
    (await request<JsonRecord>(`/templates/${id}/publish`, { method: "POST" })).data,
  importYaml: async (yaml: string) =>
    (await request<{ source: TemplateSource; compiled: JsonRecord }>("/templates/import/yaml", {
      method: "POST",
      body: { yaml },
    })).data,
  exportYaml: async (id: string) => {
    const response = await fetch(`${API_BASE}/templates/${id}/export.yaml`, { headers: AUTH_HEADERS });
    if (!response.ok) throw new ApiError(response.status, { message: "导出 YAML 失败" });
    return response.text();
  },
  optionSources: async () =>
    (await request<{ items: OptionSource[] }>("/option-sources")).data.items,
  createOptionSource: async (payload: OptionSourcePayload) =>
    (await request<OptionSource>("/option-sources", { method: "POST", body: payload })).data,
  updateOptionSource: async (id: string, payload: OptionSourcePayload) =>
    (await request<OptionSource>(`/option-sources/${id}`, { method: "PUT", body: payload })).data,
  optionItems: async (id: string, query = "", limit = 50) =>
    (await request<{ items: OptionItem[] }>(
      `/option-sources/${id}/options?query=${encodeURIComponent(query)}&limit=${limit}`,
    )).data.items,
  resolveOptionItems: async (id: string, values: string[]) =>
    (await request<{ items: OptionItem[]; missing: string[] }>(`/option-sources/${id}/resolve`, {
      method: "POST",
      body: { values },
    })).data,
  documents: async () => (await request<{ items: DocumentSummary[] }>("/documents")).data.items,
  document: async (id: string) => request<DocumentSummary>(`/documents/${id}`),
  createDocument: async (templateId: string, title: string) =>
    request<DocumentSummary>("/documents", { method: "POST", body: { templateId, title } }),
  saveDocument: async (id: string, values: JsonRecord, etag: string, idempotencyKey: string) =>
    request<DocumentSummary>(`/documents/${id}/draft`, {
      method: "PUT",
      headers: { "If-Match": etag, "Idempotency-Key": idempotencyKey },
      body: { values },
    }),
  publishDocument: async (id: string) =>
    request<JsonRecord>(`/documents/${id}/publish`, { method: "POST" }),
  publishedDocument: async (id: string) => request<DocumentSummary>(`/documents/${id}/published`),
  assets: async () => (await request<{ items: Asset[] }>("/assets")).data.items,
  asset: async (id: string) => (await request<Asset>(`/assets/${id}`)).data,
  uploadAsset: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Asset>("/assets", { method: "POST", rawBody: form });
  },
  assetBlob: async (id: string) => {
    const response = await fetch(`${API_BASE}/assets/${id}/content`, { headers: AUTH_HEADERS });
    if (!response.ok) {
      let payload: JsonRecord = { message: "资产读取失败" };
      try { payload = (await response.json()) as JsonRecord; } catch { /* keep fallback */ }
      throw new ApiError(response.status, payload);
    }
    return response.blob();
  },
  search: async (q: string) =>
    (await request<{ query: string; items: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`)).data,
};
