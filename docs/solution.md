# DocCraft Engine 方案

> 状态：首期纵向闭环已实现（2026-10-24）。本文描述已交付方案与明确边界；标为“后续”的能力不包含在当前镜像中。

## 目标与交付范围

DocCraft 以项目外部的本地 PostgreSQL、本地 Elasticsearch 和 PyUploadX 服务实现模板驱动的知识采编、发布与检索。首期完成一条可运行闭环：

1. 在可视化设计器中编排模板区块与字段，经服务端编译后发布为不可变版本。
2. 按模板动态生成文档表单，编辑富文本并上传媒体。
3. 使用 CAS 与幂等键保存草稿，固定模板版本发布。
4. Worker 校验媒体并通过 Outbox 生成 Elasticsearch 发布投影。
5. 从发布投影检索中文内容，按已发布 revision 阅读。

不包含实时协同、Canva 式自由画布、模板脚本/任意外部 HTML、多人审批流和音视频转码。

## 分层与数据所有权

| 层 | 当前实现 | 责任 |
|---|---|---|
| Web | React 19、TypeScript、Vite、Ant Design | 应用壳、列表/编辑页、可视化模板设计器、动态表单、阅读与检索 |
| API | FastAPI、Pydantic v2 | 模板与文档协议、CAS、幂等、发布、资产 API、SPA/静态资源托管 |
| Worker | Python asyncio 轮询进程 | 图片校验、Outbox 发布投影 |
| PostgreSQL | SQLAlchemy 2 AsyncSession + psycopg 3 | 模板、版本、文档指针、revision 元数据、发布记录、资产、幂等操作、Outbox |
| Elasticsearch | HTTP adapter | 只追加 draft revision；published 搜索投影；中文 `cjk` analyzer |
| PyUploadX | `pyuploadx.Client` | 二进制上传、下载、删除与健康检查；DocCraft 不直连 S3/MinIO |

PostgreSQL 表为 `templates`、`template_versions`、`documents`、`revisions`、`publications`、`assets`、`operations`、`outbox_events`。首期以租户字符串做数据隔离，尚未建立独立 Tenant/KnowledgeBase/ACL 表。

数据所有权遵循以下约束：

- 模板源 JSON 是模板唯一规范源，保存在 `template_versions.source`；YAML 仅导入和导出。
- 草稿与发布正文只保存在 Elasticsearch revision；PostgreSQL 只保存 revision ID、模板版本、内容 hash 和业务状态。
- 文档分别维护 `draft_revision_id`、`published_revision_id`、`draft_generation`、`publication_generation` 与 `control_version`，草稿更新不改变已发布指针。
- 资产元数据保存在 PostgreSQL；对象内容由 PyUploadX 持有。正文只存 `assetId`，不存 URL、base64 或对象存储凭据。
- 不同系统不声称分布式 ACID。ES 写入成功但 PG 未提交时允许留下可清理的孤儿 revision；任何有效 PG 指针都必须能找到对应正文。

## 前端交互基线

前端与当前 `ikc-demo`、`WeKnora` 对齐，细则见 [前端交互与视觉基线](frontend-interaction.md)。实现时采用“`ikc-demo` 壳层与主题骨架 + `WeKnora` 内容密度”：

- 可折叠侧栏、品牌区、分组导航、底部主题与依赖状态；四套 CSS 变量主题。
- 页头标题/说明/动作、范围切换、筛选与搜索工具条、资源卡片网格、骨架屏、空状态、抽屉和消息反馈。
- 1440px 三栏编辑器、1024px 紧凑三栏、窄屏纵向堆叠；Playwright 验证 390px 下无横向溢出。

## 模板协议

模板由 `metadata`、`fields[]`、`layout`、`workflow`、`indexing` 组成，`schemaVersion=1`。字段与区块使用稳定 ID；支持 `string/text/enum/array/object/number/boolean/date/asset/richtext`，布局支持 `stack/section/columns/field/richText/asset/staticText`。

服务端 `app/compiler.py` 负责：

- 校验根布局、重复字段/区块 ID、父子关系、嵌套深度、字段引用与字段类型匹配。
- 生成 `draft/submit/publish` 三阶段 JSON Schema、UI/View 布局索引、索引计划和模板 hash。
- 根据 `requiredAt` 校验草稿与发布内容；编译器版本固定写入发布模板版本。

示例布局：

```json
{
  "schemaVersion": 1,
  "fields": [
    {"id": "summary", "type": "text", "label": "摘要", "requiredAt": ["submit"]}
  ],
  "layout": {
    "id": "root",
    "kind": "stack",
    "children": [
      {
        "id": "sec_basic",
        "kind": "section",
        "title": "基本信息",
        "children": [
          {"id": "slot_summary", "kind": "field", "fieldId": "summary"}
        ]
      }
    ]
  }
}
```

`workflow.singleReview` 已进入协议模型，但首期发布端点采用“发布者直接发布”，审核状态机属于后续能力。

### 可视化编辑

模板设计器由组件面板、结构化画布和属性面板组成：

- 从组件面板拖入字段、富文本、媒体、分组、分栏、容器或说明区块。
- 使用浏览器原生 HTML5 拖拽实现插入与同容器排序；禁用把容器拖入自身子树的非法操作。
- 每个区块提供上移、下移、删除按钮，保证拖拽不是唯一操作路径。
- 修改布局或字段属性进入撤销/重做栈；切换选中区块时属性面板同步。
- 预览基于当前草稿渲染；校验与服务端编译使用同一规范源。
- 草稿保存必须携带 `If-Match`，冲突返回 412 并保留当前内容，避免静默覆盖。

画布只编辑声明式布局树，不做绝对定位，不执行模板脚本。当前未引入 `dnd-kit` 或 Tiptap，以免为已满足的功能增加运行时依赖。

## 文档采编与发布

创建文档时固定当前已发布的 `template_version_id`。编辑页根据模板布局生成字段控件；富文本以 JSON AST 保存，当前支持段落、二级/三级标题、项目符号/编号列表、引用、链接、粗体、斜体、行内代码、换行和图片。

草稿保存协议：

1. 校验 `If-Match` 与 `Idempotency-Key`；请求缺失分别返回 428。
2. 以幂等键查找 Operation。同键同请求直接返回原 revision 与 ETag；同键异请求返回 409。
3. 对文档行加锁并比较 `control_version`；旧版本返回 412。
4. 按草稿阶段校验字段，检查所有正文中的 `assetId` 属于当前租户且状态为 `READY`。
5. 以 create-only 方式写入 ES revision，再在 PostgreSQL 登记 Revision、推进文档指针并提交。

发布协议：

1. 锁定文档并读取当前草稿 revision。
2. 按发布阶段重新校验必填项与内容类型。
3. 再次检查 revision 引用的全部资产，防止保存后资产进入 `QUARANTINED` 或处理中状态。
4. 在同一 PostgreSQL 事务中写 Publication、推进发布指针与 generation、写 Outbox。
5. Worker 对 `publish.index` 事件生成搜索投影，使用 external version 防止旧投影覆盖新投影。

发布阅读固定 `published_revision_id`，不会随草稿变化。首期发布不要求再次提交 `If-Match`，而是通过行锁串行化并递增 `control_version`；更完整的发布前置条件可在后续扩展。

## 媒体与 PyUploadX

上传路径：

1. 浏览器把文件提交给 DocCraft API，不接触 PyUploadX API Key。
2. API 流式写入临时文件，同时检查 MIME、大小并计算 SHA-256。
3. 服务端生成 `doccraft/{env}/{tenant}/assets/{assetId}/{safeName}`，通过 `pyuploadx.Client` 上传并记录 file ID、bucket、object key、大小和 hash。
4. 图片初始为 `SCANNING`，其他允许类型初始为 `READY`。
5. Worker 通过 SDK 下载图片，使用 Pillow 校验格式与像素上限，更新为 `READY` 或 `QUARANTINED`。
6. 前端读取媒体时走 DocCraft 鉴权代理，API 经 SDK 下载后返回临时响应；不持久化签名 URL。

当前状态机为 `SCANNING -> READY | QUARANTINED`，非图片为 `READY`。删除、引用回收、超时对账、ClamAV、EXIF 清洗和音视频派生对象属于后续运维/安全能力。

## 检索与 Worker

- `doccraft-revisions-v1`：保存不可变 draft revision，`values` 字段不参与索引。
- `doccraft-published-v1`：保存标题、摘要、全文、模板版本、generation 和内容 hash，`status=published`。
- 两个索引均使用 `cjk` analyzer、`dynamic: strict` 和外部版本写入。
- Worker 每轮在 `SKIP LOCKED` 事务中领取待处理资产和 Outbox；失败按次数回到 `PENDING`，超过上限标记 `FAILED`。
- 搜索先按租户和发布状态过滤，再以 `title^4`、`summary^2`、`fullText` 多字段匹配并返回高亮片段。

## 接口与运行

主要 API：

| 能力 | 端点 |
|---|---|
| 健康与就绪 | `GET /healthz`、`GET /readyz` |
| 会话 | `GET /api/v1/session` |
| 模板 | `GET/POST /api/v1/templates`、`GET /templates/{id}`、`PUT /templates/{id}/draft`、`POST /templates/{id}/validate`、`POST /templates/{id}/publish` |
| 模板 YAML | `POST /api/v1/templates/import/yaml`、`GET /api/v1/templates/{id}/export.yaml` |
| 文档 | `GET/POST /api/v1/documents`、`GET /documents/{id}`、`PUT /documents/{id}/draft`、`POST /documents/{id}/publish`、`GET /documents/{id}/published` |
| 资产 | `GET/POST /api/v1/assets`、`GET /assets/{id}`、`GET /assets/{id}/content` |
| 检索 | `GET /api/v1/search?q=...` |

默认 `DOCCRAFT_AUTO_CREATE_SCHEMA=true` 由 ORM 元数据建表；`migrations/001_initial.sql` 提供等价 DDL。`DOCCRAFT_AUTO_INIT_INDICES=true` 创建两个 ES 索引。生产环境应关闭自动建表/建索引，改由显式迁移和索引发布流程接管。

镜像由 `Dockerfile` 构建，入口角色支持 `web/api/worker`。默认 `web` 同时启动 API、Worker 与 HAProxy：仅暴露 `5290` Web 入口和 `8404` 状态页，API 内部监听 `127.0.0.1:8100`。PG/ES/PyUploadX 通过环境变量连接，不进入本仓库 Compose 生命周期。

## 安全边界与后续路线

当前安全与一致性边界：

- 开发模式可从 `X-DocCraft-User/Tenant/Role` 注入身份；生产模式缺少身份时返回 401，但尚未接入 OIDC/JWT。
- 发布权限只区分发布者角色；细粒度文档/知识库 ACL、审计日志、审核与撤回未实现。
- SPA fallback 不接管 `api/`、`healthz`、`readyz`、文档和 OpenAPI 路径，避免把 API 404 伪装为 HTML。
- API 错误统一返回 `code/message/traceId`，持久化与存储异常分别映射为 4xx/5xx，不伪报成功。

后续优先级：

1. 接入生产身份提供方与细粒度 ACL，补审核流、撤回和审计。
2. 增加资产删除/引用回收、超时对账、病毒扫描与音视频隔离处理。
3. 增加 revision 历史、冲突重载/另存 UI、自动保存和更多富文本节点。
4. 增加 PG/ES/PyUploadX 跨系统备份恢复演练与可观测性指标。
