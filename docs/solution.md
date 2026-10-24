# DocCraft Engine 方案

## 目标与边界

首期以真实 PostgreSQL、Elasticsearch 和私有 S3 存储实现文章/FAQ/操作规程的模板驱动采编、图片、不可变版本、指定版本审核发布及阅读搜索。中文为默认语言。不实现实时协同、模板任意脚本或 Node 后端。功能交付以测试记录和路线图为准，本文同时描述目标架构，不把设计视为已交付能力。

## 分层与数据所有权

React/TypeScript/Vite/Ant Design + React Hook Form + TanStack Query；Tiptap JSON 用独立 React 阅读器渲染。FastAPI/Pydantic v2 → Service → Repository/UoW → ES/S3 Adapter。SQLAlchemy 2 类型化 ORM、asyncpg，每请求/任务独立 AsyncSession；仓储不 commit，UoW 只提供 PG 事务。Alembic 显式迁移，不按模板建表。

PG 保存 Tenant、KnowledgeBase、Template/TemplateVersion、Document、RevisionRecord、Review、Publication、Asset、UploadSession、AssetReference、Operation、OutboxEvent、Job、AuditLog 的控制元数据。正文 values/AST 只存 ES create-only revision；PG 的任务、审计、幂等记录只存摘要、ID、状态，不记录正文。S3 存隔离上传和不可变正式二进制。

Document 分离 draft_revision_id/draft_generation、published_revision_id/publication_generation、control_version、projection_generation、acl_version。RevisionRecord 只有有效版本元数据和 ES 定位；孤儿 ES 候选不进入业务历史。revision 固定模板版本/hash、编辑协议/渲染版本。

## 模板与内容协议

YAML 包含 metadata、document、fields、layout.sections、view.slots、workflow.singleReview、indexing。字段支持 string/text/enum/array/object/number/boolean/date/asset/richtext。服务端生成 draft/submit/publish JSON Schema、UI/View Schema、Index Plan、富文本策略、依赖图及 compilerVersion/templateHash。requiredAt 在相应阶段生效；保存始终检查类型和安全。使用 Draft202012Validator + FormatChecker，禁联网引用。

单文档、UTF-8 256KB、深度16、字段200；拒绝重复键、alias/anchor/merge、tag、非字符串键、危险字段 ID、未知字段/组件/索引语义。诊断包含 path/line/column。条件只有 eq/ne/in/exists/and/or/not，依赖图拒绝循环。visibleWhen 只影响 UI，隐藏字段 preserve，不授予权限。发布模板不可变，被引用版本不可删除；升级不影响旧文档。迁移必须 dry-run 后产生新 revision，绝不覆盖发布正文。

AST 白名单支持段落、标题、列表、引用、代码、表格、链接及 kbImage/kbVideo/kbAudio/kbAttachment/kbDocumentLink。blockId 为稳定标识，媒体只存 assetId 和受限描述/尺寸，不存 URL/base64。Python 验证属性、节点、深度、大小、URL，独立提取纯文本和安全 HTML；React 用显式组件渲染，不执行 HTML。共享 JSON fixtures 保证双端语义，不假设 Python 可执行 TS。拒绝 iframe、任意 HTML/style、危险协议和未知节点；粘贴经编辑器 schema 净化。

## 保存与恢复

请求带 If-Match + Idempotency-Key。先鉴权和校验，短事务 A 登记 Operation（请求摘要、固定 revisionId、预期 generation）和在途资产保护；事务外 create-only 写 ES；短事务 B 重做鉴权、确认 Operation，CAS draft_generation，登记 RevisionRecord、切换指针、固化引用、审计/Outbox、标记 COMMITTED。缺前提428，旧版本412，同键异请求409。摘要包含模板、目标、条件和内容。

响应丢失后同键同请求返回原 revision/ETag；ES 超时按固定 ID GET 验证 operationId/contentHash 后继续，不分配新 ID。不能仅因 ES 存在就让版本有效；不能从 PG 摘要恢复未写入正文。并发恢复通过 Operation 锁与 CAS 保证唯一提交。重试必须保留原请求，失败候选延迟清理。

刷新先 PG 权限/指针，再 ES GET，不用搜索确认保存。自动保存需去抖、串行、内容去重、IME 暂停、离线错误可见；冲突需显式重新载入或另存，不能覆盖。历史保留当前草稿、审核、发布、手动快照；自动快照只能经引用检查清理，禁止正文 TTL。

## 流程、权限和检索

审核固定 revision，不能自审；编辑草稿不影响审核候选或发布。发布在同一 PG 事务中验证指定 revision 已批准、发布权限和引用 READY，写 Publication、指针、审计、Outbox。撤回立即受 PG 约束，恢复历史产生新草稿。

认证上下文确定 tenant/user，不接受任意租户 header。角色 reader/editor/reviewer/publisher/template_admin/kb_admin/tenant_admin 按知识库和文档 ACL 授权；关联查询同样带租户。无身份提供方时只允许显式开发身份适配器，生产 fail closed。ES 不对浏览器暴露。

正文索引真实 _source、dynamic:strict、values/template enabled:false。draft-search 和 published-search 为派生投影，服务器提取 title/summary/fullText；精确字段 flattened，日期/数值固定 typed nested，拒绝无法正确支持的分组语义。首期中文使用内置可部署 cjk analyzer，无外置插件。

Outbox Worker 每次读取 PG 当前指针，按单调 projection_generation 使用 ES external version 写投影；撤回/删除写高版本 tombstone，不能简单删除丢失版本屏障。搜索候选先 tenant/ACL 限定，后 PG 批量最终鉴权和比对 published_revision_id，剔除陈旧结果并补取。不返回 ES 原始 total、聚合或未授权摘要。首期可限制返回数量，不承诺无限分页；未来 PIT/search_after 游标绑定用户/租户/查询。

## 媒体与任务

资产状态 INITIATED→UPLOADING→UPLOADED→SCANNING→PROCESSING→READY，异常 FAILED/QUARANTINED；删除 DELETING→DELETED。随机隔离 key，完成时核验真实大小、magic、checksum、配额；扫描后 Pillow 解码、像素限制、清理 EXIF、重新编码，写新的不可变正式 key。SVG 拒绝，旧上传链接不能覆盖正式资源。草稿可展示处理状态；发布仅 READY。

私有资源通过鉴权代理访问：同租户且对真实引用 revision 有权限；未引用上传仅上传者/明确媒体库权限可访问。代理强撤销；如未来使用短时签名 URL，必须说明失效窗口。删除先 DELETING 禁止新引用，再安全期复查所有保留 revision、审核/发布和在途 Operation，最后删除；不能只检查当前草稿。

独立 Python Worker 从 PG 短事务 SKIP LOCKED 领取 Job/Outbox，持久租约、随机 fencing token、超时重领、退避、重试上限与死信；网络/扫描/转码在事务外，更新必须匹配 token。任务只含 ID。扫描开发替身显式配置且生产禁用；生产使用 ClamAV。音视频后续通过隔离 FFmpeg Worker 限制 CPU/内存/时长，原始和派生对象分离。

## 运维、恢复与扩展

Compose 固定 Web/API/Worker/PG/ES/S3/扫描服务版本，私有数据端口不对外。环境变量无生产默认密钥。统一错误 code/message/traceId/details(path)，OpenAPI 为实际端点，不为未实现能力返回假成功。

备份先进入写入维护窗口/记录一致水位，等待在途保存和对象落盘，记录 PG 指针与有效 revision 清单，再保存 PG、对应 ES revision 和 S3 版本/清单及校验和；独立备份不天然一致。恢复到隔离环境，先对象/ES 后 PG，按清单验证每个指针/资产/模板 hash，缺失对象不得开放读取。重建搜索投影并补发幂等任务；完成引用/权限/抽样阅读校验后切流。备份加密、离站、定期演练，明确 RPO/RTO。在线备份需后续实现带跨系统水位的变更日志重放。

导入将数据先放隔离区，限制压缩比/条目/路径，模板校验和资源扫描后才产生新 revision；导出固定 PG 指针集、模板/AST版本、资源清单及 checksum，HTML 转义，不能导出未授权历史。跨版本迁移提供 dry-run、错误报告、可重试操作记录与回滚新 revision，不能原地改旧内容。
