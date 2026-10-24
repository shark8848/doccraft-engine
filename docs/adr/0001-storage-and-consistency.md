# ADR 0001：控制面事务、不可变正文与 PyUploadX 二进制存储

状态：采纳（2026-10-24 修订）。

正文仅在 ES，PG 只保存指针/权限/元数据，二进制统一由 PyUploadX 服务承载。DocCraft 通过 `pyuploadx.Client` 在 API/Worker 内上传、下载、查询、删除和管理生命周期，不直接连接 S3，也不复制分片/断点续传协议；PG 的 Asset 只保存 `bucket`、`object_key`、PyUploadX `file_id`、checksum 和业务状态。使用 SQLAlchemy 2 AsyncSession + psycopg 3 与显式 PG 事务；不声称 ES/PG/PyUploadX 有分布式 ACID。文档保存采用“幂等 Operation 查询 → 文档行锁与 CAS → create-only ES revision → PG 登记/提交”的顺序，允许可清理孤儿但不允许有效指针指向未确认正文。资产使用确定性 object key 降低响应丢失后的重复写入风险；完整的超时对账与清理仍为后续运维能力。发布固定 revision，不追随草稿。

代价：新增 PyUploadX 及其 PG/Redis/对象存储故障域；需要资产对账、幂等恢复、Outbox 和跨系统一致备份水位。ES 不可用时不能保存/阅读，PyUploadX 不可用时不能新增或读取媒体。搜索最终一致，读取/撤回和对象授权以 DocCraft PG 为准，PyUploadX 元数据不作为权限来源。禁止用 PG 正文副本掩盖 ES 故障，也禁止把预签名 URL 当持久引用。
