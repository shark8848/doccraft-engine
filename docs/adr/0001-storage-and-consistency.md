# ADR 0001：控制面事务与不可变正文

状态：采纳。

正文仅在 ES，PG 只保存指针/权限/元数据，S3 保存二进制。使用 SQLAlchemy AsyncSession + 显式 PG UoW；不声称 ES/S3/PG 有分布式 ACID。选择登记 Operation → create-only ES → PG CAS 的协议，允许可清理孤儿但不允许有效指针指向未确认正文。审核/发布固定 revision，不追随草稿。

代价：需要幂等恢复、对账、Outbox 和一致性备份水位；ES 不可用时不能保存/阅读。搜索最终一致，读取/撤回权限以 PG 为准。禁止用 PG 正文副本掩盖 ES 故障。
