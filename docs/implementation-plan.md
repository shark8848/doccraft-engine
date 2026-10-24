# 实施计划与交付门槛

1. 固定协议与设计：分层、DSL、AST、CAS、权限和故障恢复。
2. 模板编译与共享 fixtures：受限 YAML、三个示例、阶段 Schema、安全 AST。
3. Python 控制面：ORM/Alembic、开发认证隔离、真实 ES/S3 adapters、保存幂等/CAS、审核发布。
4. 独立 Worker：图片扫描/清理、持久任务、Outbox 投影、重启恢复。
5. 中文 Web：模板管理、动态表单、Tiptap、图片、保存刷新/历史/审核/发布/阅读搜索。
6. 工程交付：uv/npm 锁、固定版本 Compose、实际 OpenAPI、运行说明。
7. 验证：Ruff/mypy/pytest、前端构建/Playwright、真实 PG/ES/S3 集成、安全扫描。

验收以实际命令结果为准，未运行不写通过。优先可运行首期纵向闭环；不完整的媒体类型、迁移/导入导出、清理和高级 ACL/搜索在路线图中逐项声明，不做假成功接口。
