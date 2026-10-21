# 后端待办

仅保留尚未交付或待确认的事项。2026-10-21 清理的 10 份任务原文见[历史归档](../../docs/verification/2026-10-21-backend-task-archive.md)，包括全部验证记录、服务器备份路径和 AOCI 恢复身份。归档里的历史计划不重复执行。

## 待办

- [ ] 团号建议的前端配套发布：仍在原前端暂存内容中，后续交付见[前端待办](../../sunrise-travel-ops-web/REVIEW-FIXES-TODO.md)。菜单树、航班分页已随前端fd4b9d8发布dev，见[前端发布记录](../../docs/deployment/2026-10-21-frontend-row-export-dev-release.md)。
AOCI 历史阻塞已归并本次独立维护，当前进度和最终机器证据见 [恢复记录](../../.aoci/drafts/20261021-alignment-cleanup/RECOVERY.md)，原始停点保留在历史归档，不重复分散列待办。

## 已完成事项的记录入口

- 发布状态优化实现与本轮dev交付跟踪：[本轮发布记录](../../docs/deployment/2026-10-21-backend-release-status-dev.md)。使用当前三个部署文件，不重复合入旧28c22cd及其已归档TODO；实际部署是否完成以记录和线上版本为准。

- 询盘字段、公共资源按 ID 查询及相关 dev 发布：[发布记录](../../docs/deployment/2026-10-21-backend-dev-release.md)、[前端配套与当时 AOCI 对齐记录](../../docs/verification/2026-10-21-frontend-release-aoci-cleanup.md)。
- 菜单树、航班分页、团号建议后端：[dev 发布记录](../../docs/deployment/2026-10-21-api-dev-release.md)。
- 访问记录台账、两环境迁移及旧 viewer 退役：[部署及恢复记录](../../docs/deployment/2026-10-21-website-visit-ledger.md)。
- 9 个生产账号英文名/团号标识维护：[完整历史与服务器恢复入口](../../docs/verification/2026-10-21-backend-task-archive.md#prod-user-names)。已执行，不重复更新。

历史清理未发布；本轮已获准提交并部署后端。根目录历史归档和发布记录仍不随子仓提交自动交付。
