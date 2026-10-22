# 后端待办

仅保留尚未交付或待确认的事项。2026-10-21 清理的 10 份任务原文见[历史归档](../../docs/verification/2026-10-21-backend-task-archive.md)，包括验证记录、服务器备份路径和 AOCI 恢复身份。历史计划及授权不代表本轮执行授权，不重复已完成操作。

## 待办

- [ ] 独立站询盘汇总前端配套：后端已新增三个日志查询接口和 `WebsiteInquiryLogReport` 导航；当前前端尚未注册该路由，需按[前端 prompt](../../docs/plans/2026-10-22-website-inquiry-summary-frontend-prompt.md)完成页面、菜单权限和跳转后配套发布。旧前端遇到未知 routeName 会报导航配置错误，不应单独上线后端。
- [ ] 独立站询盘汇总迁移与发布准备：`1793059200000-AddWebsiteInquiryLogSummary.ts` 仅有源文件，本次未执行迁移或真实数据库测试。后续先在隔离库验证旧日志升级、字段约束和三个查询，再按目标环境核对 pending migrations、授权及发布流程；不回填历史字段差异。已有新审计数据时迁移 down 会拒绝丢弃历史。
- [!] AOCI 索引对齐：2026-10-22 的 Maintain/Guide 因两个新增测试的 observed_pending 和无关历史漂移停止，未签发本次独立候选批次；`pending_transactions=0`、`recovery_pending=false`，未写正式索引或 Baseline。独立维护时先运行当前 Guide，复核精确 observed 集合并按完整机器批次继续，不裁剪候选。入口：`/Users/joe/.local/share/aoci/0.1.0-rc12/aoci index agent guide --agent codex --json`。上一轮已完成对齐的历史证据见[恢复记录](../../.aoci/drafts/20261021-alignment-cleanup/RECOVERY.md)，不代表当前仍已对齐。

根需求、API、架构、前端 prompt 及 `scripts/check-role-permissions.cjs` 已同步，但不属于后端 Git 仓库，需单独交付；不在子仓复制共享合同。

## 已完成事项的记录入口

- 团号建议前端配套已从独立目录以 `1332d52` 发布 dev，原前端暂存区保持不变，见 [发布记录](../../docs/deployment/2026-10-21-tour-code-frontend-dev-release.md)。

- 发布状态优化已于2026-10-21交付 dev，版本 `8c5792d`，见[发布记录](../../docs/deployment/2026-10-21-backend-release-status-dev.md)。不重复合入旧28c22cd及其已归档TODO；历史结果不代表当前在线版本。

- 独立站询盘汇总后端已完成本地实现：独立明细/汇总/操作人查询、同范围筛选、事务内字段差异、历史空差异标记、独立菜单授权及追加迁移。需求及接口见根[独立站需求](../../docs/requirements/独立站行程与报价V1.md#询盘汇总)和[统一 API 第18.2.1节](../../docs/api/Sunrise%20TravelOps%20后端说明.md)。24项定向测试、受影响 ESLint、类型、迁移命名及角色权限检查通过；尚未完成的数据库与前端工作只在上方保留。

- 询盘字段、公共资源按 ID 查询及相关 dev 发布：[发布记录](../../docs/deployment/2026-10-21-backend-dev-release.md)、[前端配套与当时 AOCI 对齐记录](../../docs/verification/2026-10-21-frontend-release-aoci-cleanup.md)。
- 菜单树、航班分页、团号建议后端：[dev 发布记录](../../docs/deployment/2026-10-21-api-dev-release.md)。
- 访问记录台账、两环境迁移及旧 viewer 退役：[部署及恢复记录](../../docs/deployment/2026-10-21-website-visit-ledger.md)。
- 9 个生产账号英文名/团号标识维护：[完整历史与服务器恢复入口](../../docs/verification/2026-10-21-backend-task-archive.md#prod-user-names)。已执行，不重复更新。

本轮仅授权本地提交及 TODO 清理，不推送、部署或操作业务数据库。根目录历史归档和发布记录不随子仓提交自动交付。
