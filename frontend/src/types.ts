export type Stage = "draft" | "submit" | "publish";
export type FieldType =
  | "string"
  | "text"
  | "enum"
  | "array"
  | "object"
  | "number"
  | "boolean"
  | "date"
  | "asset"
  | "richtext";
export type BlockKind = "stack" | "section" | "columns" | "field" | "richText" | "asset" | "staticText";

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldOptionsSource {
  sourceId: string;
}

export interface TemplateField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  help?: string;
  requiredAt: Stage[];
  options?: FieldOption[];
  optionsSource?: FieldOptionsSource;
}

export interface LayoutBlock {
  id: string;
  kind: BlockKind;
  title: string;
  fieldId: string | null;
  text: string;
  children: LayoutBlock[];
}

export interface TemplateSource {
  schemaVersion: 1;
  metadata: { name: string; description: string };
  fields: TemplateField[];
  layout: LayoutBlock;
  workflow: { singleReview: boolean };
  indexing: { titleField: string; summaryField: string; fullTextField: string };
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  controlVersion: number;
  publishedVersionId: string | null;
  status: "draft" | "published";
  updatedAt: string;
  createdAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  source: TemplateSource;
  compiled: Record<string, unknown>;
  publishedVersion: { id: string; version: number; templateHash: string; publishedAt: string } | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  status: string;
  templateId: string;
  templateVersionId: string;
  templateName: string;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  controlVersion: number;
  draftGeneration: number;
  publicationGeneration: number;
  createdAt: string;
  updatedAt: string;
  content?: Record<string, unknown> | null;
  templateSource?: TemplateSource | null;
}

export interface Asset {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: "SCANNING" | "READY" | "QUARANTINED" | string;
  bucket: string;
  objectKey: string;
  contentUrl: string;
  createdAt: string;
  errorMessage: string | null;
}

export interface SearchHit {
  documentId: string;
  title: string;
  summary: string;
  score: number;
  highlight: Record<string, string[]>;
}

export interface SessionInfo {
  tenantId: string;
  userId: string;
  role: string;
  authMode: string;
  version: string;
}

export interface OptionItem {
  value: string;
  label: string;
}

export interface OptionSource {
  id: string;
  name: string;
  description: string;
  provider: string;
  enabled: boolean;
  tableName: string;
  valueColumn: string;
  labelColumn: string;
  searchColumns: string[];
  activeColumn: string;
  orderBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OptionSourcePayload {
  name: string;
  description: string;
  enabled: boolean;
  tableName: string;
  valueColumn: string;
  labelColumn: string;
  searchColumns: string[];
  activeColumn: string;
  orderBy: string[];
}

export type JsonRecord = Record<string, unknown>;
