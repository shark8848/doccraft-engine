from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DOCCRAFT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "DocCraft Engine"
    env: str = "dev"
    version: str = "0.1.0"
    host: str = "127.0.0.1"
    port: int = 8100

    database_url: str = (
        "postgresql+psycopg://open-ikc-platform:1qaz2wsx3edc@127.0.0.1:5432/doccraft"
    )
    database_echo: bool = False

    es_url: str = "https://127.0.0.1:9200"
    es_username: str = "elastic"
    es_password: str = ""
    es_verify_tls: bool = False
    es_timeout: float = 10.0
    es_index_prefix: str = "doccraft"

    pyuploadx_base_url: str = "http://127.0.0.1:8000"
    pyuploadx_api_key: str = "dev-key"
    pyuploadx_bucket: str = "ikc-core"
    pyuploadx_state_dir: str = "~/.pyuploadx/uploads"
    media_max_bytes: int = 50 * 1024 * 1024
    media_allowed_mime: str = (
        "image/png,image/jpeg,image/webp,image/gif,application/pdf,"
        "video/mp4,audio/mpeg,text/plain"
    )

    auth_mode: str = "dev"
    default_tenant: str = "default"
    default_user: str = "dev-user"
    default_role: str = "publisher"
    api_prefix: str = "/api/v1"

    cors_origins: str = "http://localhost:5174,http://127.0.0.1:5174,http://localhost:5290"
    worker_poll_seconds: float = 1.5
    max_template_bytes: int = 256 * 1024
    auto_create_schema: bool = True
    auto_init_indices: bool = True
    seed_dev_data: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def allowed_mime_types(self) -> set[str]:
        return {item.strip() for item in self.media_allowed_mime.split(",") if item.strip()}

    @property
    def revision_index(self) -> str:
        return f"{self.es_index_prefix}-revisions-v1"

    @property
    def published_index(self) -> str:
        return f"{self.es_index_prefix}-published-v1"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
