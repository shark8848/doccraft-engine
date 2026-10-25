-- Dynamic option sources and the Zhejiang city business lookup table.

BEGIN;

CREATE TABLE IF NOT EXISTS biz_region_city (
    city_code VARCHAR(12) PRIMARY KEY,
    city_name VARCHAR(80) NOT NULL,
    province_code VARCHAR(12) NOT NULL,
    province_name VARCHAR(40) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_biz_region_city_province_code ON biz_region_city (province_code);

CREATE TABLE IF NOT EXISTS option_sources (
    id VARCHAR(80) PRIMARY KEY,
    tenant_id VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    provider VARCHAR(40) NOT NULL DEFAULT 'postgres_table',
    config JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_option_source_name UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS ix_option_sources_tenant_id ON option_sources (tenant_id);

INSERT INTO biz_region_city (city_code, city_name, province_code, province_name, enabled, sort_order)
VALUES
    ('330100', '杭州市', '330000', '浙江省', TRUE, 10),
    ('330200', '宁波市', '330000', '浙江省', TRUE, 20),
    ('330300', '温州市', '330000', '浙江省', TRUE, 30),
    ('330400', '嘉兴市', '330000', '浙江省', TRUE, 40),
    ('330500', '湖州市', '330000', '浙江省', TRUE, 50),
    ('330600', '绍兴市', '330000', '浙江省', TRUE, 60),
    ('330700', '金华市', '330000', '浙江省', TRUE, 70),
    ('330800', '衢州市', '330000', '浙江省', TRUE, 80),
    ('330900', '舟山市', '330000', '浙江省', TRUE, 90),
    ('331000', '台州市', '330000', '浙江省', TRUE, 100),
    ('331100', '丽水市', '330000', '浙江省', TRUE, 110)
ON CONFLICT (city_code) DO NOTHING;

INSERT INTO option_sources
    (id, tenant_id, name, description, provider, config, enabled, created_by)
VALUES
    (
        'src_zhejiang_cities',
        'default',
        '浙江省地市',
        '从 biz_region_city 业务表动态读取浙江省地市代码和名称',
        'postgres_table',
        '{"tableName":"biz_region_city","valueColumn":"city_code","labelColumn":"city_name","searchColumns":["city_name","city_code"],"activeColumn":"enabled","orderBy":["sort_order","city_code"]}'::jsonb,
        TRUE,
        'dev-user'
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
