# 实施计划与交付门槛

## 当前状态

首期纵向闭环已实现并完成本地验证。实现以可运行链路为准，不用设计文档替代代码或测试结果。

## 已交付

1. 协议：模板规范 JSON、三阶段校验、布局树、富文本 AST、CAS 与幂等保存、发布 Outbox。
2. 模板：创建/读取/列表、草稿保存、校验、发布、YAML 导入导出；三栏可视化编辑器、结构化拖拽、上移/下移、撤销/重做、字段属性、预览。
3. 控制面：PostgreSQL ORM 与首期 DDL、ES revision/发布索引、PyUploadX Client 网关、开发身份、发布检查、资产引用检查。
4. Worker：图片 Pillow 校验、资产状态推进、Outbox 发布投影与失败重试。
5. Web：`ikc-demo`/`WeKnora` 对齐的应用壳、四主题、页头/工具条/卡片/空状态/抽屉/消息、模板与文档编辑、阅读、检索和媒体库。
6. 交付：`requirements.txt`、Dockerfile、Compose、HAProxy、构建导出脚本与运行说明。

## 已验证门槛

- 编译器测试：7 项通过。
- PostgreSQL 集成测试：模板发布、文档创建、CAS 冲突、幂等重放、发布、Outbox、媒体发布拦截通过。
- 真实服务 smoke：PyUploadX 上传、Worker 图片校验、ES 草稿 revision、发布投影与中文检索通过。
- 前端：`npm run build` 通过；Playwright 覆盖桌面/移动导航、模板编辑与撤销、预览、主题切换、检索进入文档、窄屏无横向溢出。
- 截图：1440、1024、390px 三档已检查。
- 镜像：`doccraft-engine:0.1.0` 构建成功，导出 `docker/images/doccraft-engine_0.1.0.tar.gz`（71 MB）；以 `5291:5290` 启动后 `/healthz`、`/readyz`、SPA 均返回 200，镜像级 Playwright 6 项通过，真实 PyUploadX/Worker/ES 发布检索 smoke 通过。

## 后续门槛

- 接入生产身份提供方、细粒度 ACL、审核/撤回与审计。
- 增加资产删除/引用回收、超时对账、ClamAV、音视频隔离处理和备份恢复演练。
- 补齐 revision 历史/冲突重载/自动保存、模板阅读与移动预览、富文本更多节点。
- 增加 720px 视觉回归、键盘 E2E、axe 扫描和前后端锁文件升级流程。

验收以实际命令结果为准；未运行的能力不写成已通过。
