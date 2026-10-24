# DocCraft Engine

模板驱动的知识采编、发布与检索平台。首期纵向闭环已实现：可视化模板编辑、动态文档采编、富文本与媒体上传、CAS 草稿保存、发布阅读、Elasticsearch 检索，以及可导出的 Docker 镜像。

## 已实现能力

- 模板：创建、列表、详情、草稿 CAS 保存、服务端校验、不可变版本发布、YAML 导入/导出。
- 可视化模板设计器：组件面板、结构化拖拽、同一容器内排序、上移/下移、字段属性编辑、删除、撤销/重做、表单预览、发布。
- 文档：按已发布模板动态渲染表单；富文本支持标题、列表、引用、链接和图片；草稿保存使用 `If-Match` + `Idempotency-Key`，发布时重新校验内容与媒体状态。
- 阅读与检索：发布正文与草稿正文分离；Elasticsearch 保存不可变 revision，Worker 通过 Outbox 生成发布投影，支持中文检索。
- 媒体：后端仅通过 `pyuploadx.Client` 上传、下载、删除和检查服务；租户隔离、大小/MIME 校验、SHA-256 记录、图片异步校验。
- 前端：React 19 + TypeScript + Ant Design；沿用 `ikc-demo` 的侧栏/主题骨架和 `WeKnora` 的页头、工具条、卡片、空状态与消息反馈。

## 技术架构

- 前端：React、TypeScript、Vite、Ant Design；hash 路由；四套 CSS 主题；原生 HTML5 拖拽；`contentEditable` 富文本编辑并序列化为 JSON AST。
- API：FastAPI、Pydantic v2、SQLAlchemy 2 AsyncSession、psycopg 3。
- 控制面：PostgreSQL 保存模板、模板版本、文档指针、revision 元数据、发布记录、资产、幂等操作和 Outbox。
- 正文：Elasticsearch 保存只追加的 draft revision；发布投影写入 published 索引。PostgreSQL 不复制正文。
- 二进制：PyUploadX 服务持有对象；DocCraft 不引入 boto3/MinIO 客户端，不向浏览器暴露 PyUploadX API Key。
- Worker：轮询资产扫描任务与 Outbox；图片使用 Pillow 校验后标记 `READY`，异常标记 `QUARANTINED`。

PostgreSQL、Elasticsearch 和 PyUploadX 均为项目外部的本地服务，本仓库只负责连接、初始化和业务调用。

## 本地运行

准备 PostgreSQL、Elasticsearch、PyUploadX 三个本地服务，然后创建配置：

```bash
cp .env.example .env
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=/path/to/PyUploadX/sdk:$PYTHONPATH python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

另开终端启动 Worker：

```bash
. .venv/bin/activate
PYTHONPATH=/path/to/PyUploadX/sdk:$PYTHONPATH python3 -m app.worker
```

如使用已安装的 `pyuploadx` 包，可去掉 `PYTHONPATH`。默认 `DOCCRAFT_AUTO_CREATE_SCHEMA=true` 会按 ORM 元数据创建首期表；`migrations/001_initial.sql` 提供等价 DDL 供外部迁移流程使用。API 文档位于 `http://127.0.0.1:8100/docs`。

前端开发：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发地址为 `http://127.0.0.1:5174`。生产构建会由 API 服务直接托管 `frontend/dist`。

## Docker 交付

```bash
bash scripts/build_docker.sh
docker load -i docker/images/doccraft-engine_0.1.0.tar.gz
cp .env.example .env
docker compose up -d
curl -fsS http://127.0.0.1:5290/healthz
curl -fsS http://127.0.0.1:5290/readyz
```

镜像内由 HAProxy 在 `5290` 提供唯一 Web 入口，转发到仅监听容器回环的 API `8100`；`8404` 为 HAProxy 状态页。Compose 使用 `host.docker.internal` 连接宿主机上的 PG、ES 与 PyUploadX，可通过 `.env` 覆盖。

## 验证

```bash
PYTHONPATH=/path/to/PyUploadX/sdk:$PYTHONPATH python3 -m pytest tests/test_compiler.py
DOCCRAFT_INTEGRATION=1 PYTHONPATH=/path/to/PyUploadX/sdk:$PYTHONPATH python3 -m pytest tests/test_api_integration.py
cd frontend && npm run build && npm run test:e2e
```

集成测试需要一次性测试库 `doccraft_test`，测试会重建该库中的表。Playwright 默认访问 `http://127.0.0.1:8100`，可通过 `DOCCRAFT_WEB_URL` 覆盖。

## 首期边界

- 开发身份通过 `X-DocCraft-User/Tenant/Role` 或默认配置注入；生产身份提供方、细粒度 ACL、审核流和撤回尚未接入。
- 审核发布当前为“发布者直接发布”，不包含多人审批、自审限制和审核历史页面。
- 图片走 Pillow 结构校验；非图片资产直接标记 `READY`，尚未接入 ClamAV、音视频转码和隔离 FFmpeg Worker。
- 模板设计器支持结构化拖拽与键盘上移/下移，但不是 Canva 式自由画布；富文本编辑器当前支持图片，视频/音频/附件节点留待后续。
- 资产删除、引用清理、跨系统备份恢复演练和 PyUploadX 超时对账属于后续运维能力。
