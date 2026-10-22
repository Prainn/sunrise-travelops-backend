# 后端待办

仅保留尚未交付或待确认的事项。2026-10-21 清理的 10 份任务原文见[历史归档](../../docs/verification/2026-10-21-backend-task-archive.md)，包括验证记录、服务器备份路径和 AOCI 恢复身份。历史计划及授权不代表本轮执行授权，不重复已完成操作。

## 待办

暂无独立后端开发待办。独立站汇总前端已实现，后端迁移与发布已完成；本轮前后端发布及 AOCI 收尾统一跟踪[发布记录](../../docs/deployment/2026-10-22-inquiry-summary-dev-release.md)，不重复迁移或保留失效阻塞项。

根需求、API、架构、前端 prompt 及 `scripts/check-role-permissions.cjs` 已同步，但不属于后端 Git 仓库，需单独交付；不在子仓复制共享合同。

## 已完成事项的记录入口

- 团号建议前端配套已从独立目录以 `1332d52` 发布 dev，原前端暂存区保持不变，见 [发布记录](../../docs/deployment/2026-10-21-tour-code-frontend-dev-release.md)。

- 发布状态优化已于2026-10-21交付 dev，版本 `8c5792d`，见[发布记录](../../docs/deployment/2026-10-21-backend-release-status-dev.md)。不重复合入旧28c22cd及其已归档TODO；历史结果不代表当前在线版本。

- 独立站询盘汇总后端已实现并部署 dev：独立明细/汇总/操作人查询、同范围筛选、事务内字段差异、历史空差异标记、独立菜单授权及追加迁移。需求及接口见根[独立站需求](../../docs/requirements/独立站行程与报价V1.md#询盘汇总)和[统一 API 第18.2.1节](../../docs/api/Sunrise%20TravelOps%20后端说明.md)。24项定向测试、受影响 ESLint、类型、迁移命名及角色权限检查通过；迁移 SQL 的隔离旧数据/默认值/约束核验及 dev 第70条迁移已完成，见[部署证据](../../docs/deployment/2026-10-22-dev-release-safety.md)。2026-10-22 本轮现场再次确认迁移已执行、无待执行项；不重复测试或迁移。

- 询盘字段、公共资源按 ID 查询及相关 dev 发布：[发布记录](../../docs/deployment/2026-10-21-backend-dev-release.md)、[前端配套与当时 AOCI 对齐记录](../../docs/verification/2026-10-21-frontend-release-aoci-cleanup.md)。
- 菜单树、航班分页、团号建议后端：[dev 发布记录](../../docs/deployment/2026-10-21-api-dev-release.md)。
- 访问记录台账、两环境迁移及旧 viewer 退役：[部署及恢复记录](../../docs/deployment/2026-10-21-website-visit-ledger.md)。
- 9 个生产账号英文名/团号标识维护：[完整历史与服务器恢复入口](../../docs/verification/2026-10-21-backend-task-archive.md#prod-user-names)。已执行，不重复更新。

本轮用户已授权使用 dev-fast 提交和部署当前前后端 dev 改动，并更新 AOCI 与错题本。根目录历史归档和发布记录不随子仓提交自动交付。
