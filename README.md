# DocCraft Engine

模板驱动的知识采编服务与富文本编辑平台。

## 项目状态

仓库初始化完成，业务功能待实现。以下是计划采用的架构，并不代表功能已经交付。

## 目标架构

- 前端：React、TypeScript、Tiptap / ProseMirror。
- 后端：Python、FastAPI、SQLAlchemy ORM、Alembic。
- 模板：YAML 定义，编译为字段校验、采编布局与阅读布局。
- 正文：JSON 和富文本 AST 存储在 Elasticsearch，采用不可变 revision。
- 控制面：PostgreSQL 保存权限、版本指针、审核发布、媒体元数据及持久化任务；不复制文档正文。
- 媒体：图片、视频、音频、附件存储在 S3 兼容对象存储，正文仅通过 assetId 引用。

## 首期目标

实现模板编译、动态采编、富文本与图片上传、草稿保存和版本控制、审核发布、阅读与检索的可运行闭环，并提供测试、部署说明和完整设计文档。
