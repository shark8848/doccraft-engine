-- DocCraft v1 schema. The application also creates the same tables from ORM
-- metadata on an empty development database; this file is the portable DDL
-- baseline for managed PostgreSQL deployments.

BEGIN;

CREATE TABLE IF NOT EXISTS templates (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    draft_source JSONB NOT NULL,
    control_version INTEGER NOT NULL,
    published_version_id VARCHAR(80),
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_templates_tenant_id ON templates (tenant_id);

CREATE TABLE IF NOT EXISTS template_versions (
    id VARCHAR(80) PRIMARY KEY,
    template_id VARCHAR(80) NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    source JSONB NOT NULL,
    compiled JSONB NOT NULL,
    template_hash VARCHAR(64) NOT NULL,
    compiler_version VARCHAR(32) NOT NULL,
    published_by VARCHAR(80) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_template_version UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS ix_template_versions_template_id ON template_versions (template_id);

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id VARCHAR(80) NOT NULL,
    template_id VARCHAR(80) NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
    template_version_id VARCHAR(80) NOT NULL,
    title VARCHAR(300) NOT NULL,
    status VARCHAR(24) NOT NULL,
    draft_revision_id VARCHAR(80),
    published_revision_id VARCHAR(80),
    draft_generation INTEGER NOT NULL,
    publication_generation INTEGER NOT NULL,
    control_version INTEGER NOT NULL,
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_documents_tenant_id ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS ix_documents_template_id ON documents (template_id);

CREATE TABLE IF NOT EXISTS revisions (
    id VARCHAR(80) PRIMARY KEY,
    document_id VARCHAR(80) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL,
    template_version_id VARCHAR(80) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    es_index VARCHAR(200) NOT NULL,
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_document_revision_no UNIQUE (document_id, revision_no)
);
CREATE INDEX IF NOT EXISTS ix_revisions_document_id ON revisions (document_id);

CREATE TABLE IF NOT EXISTS publications (
    id VARCHAR(80) PRIMARY KEY,
    document_id VARCHAR(80) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision_id VARCHAR(80) NOT NULL,
    generation INTEGER NOT NULL,
    published_by VARCHAR(80) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_publications_document_id ON publications (document_id);

CREATE TABLE IF NOT EXISTS assets (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id VARCHAR(80) NOT NULL,
    bucket VARCHAR(200) NOT NULL,
    object_key TEXT NOT NULL,
    pyuploadx_file_id VARCHAR(80) NOT NULL,
    original_name VARCHAR(300) NOT NULL,
    mime_type VARCHAR(200) NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL,
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS ix_assets_tenant_id ON assets (tenant_id);
CREATE INDEX IF NOT EXISTS ix_assets_tenant_status ON assets (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_assets_pyuploadx_file_id ON assets (pyuploadx_file_id);

CREATE TABLE IF NOT EXISTS operations (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id VARCHAR(80) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    operation VARCHAR(80) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_operation_key UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id VARCHAR(80) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(80) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(24) NOT NULL,
    attempts INTEGER NOT NULL,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_outbox_status_created ON outbox_events (status, created_at);

COMMIT;
