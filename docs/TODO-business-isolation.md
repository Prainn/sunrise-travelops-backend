# 业务隔离自测（2026-10-23）

- [x] 核对直客台账、成团、三业务询盘权限合同及现有集成测试，设计临时数据库夹具。
- [x] 编写真实 PostgreSQL/HTTP 隔离测试，覆盖正常访问、跨业务与本人范围、筛选计数和越权写入不变性。
- [x] 接入后端独立 CI 步骤；保持 verify:release、Dockerfile、前后端部署入口不变。
- [x] 在一次性本地数据库验证，执行受影响 lint/类型检查，补充运行说明。
- [!] AOCI已尝试最终维护，但被混合历史漂移及他人observe/孤儿项阻塞；未形成可独立签发的本任务批次。

边界：仅修改测试与 CI 配置，发现实际隔离缺陷时再按证据修正。不提交、推送或发布，不访问业务库。复用现有 integration-check 的 Nest 测试装配，使用真实服务、权限和数据库查询。

证据入口：test/manual-ledgers.integration-check.ts、test/tour-management.integration-check.ts、test/website.integration-check.ts；根 docs/requirements/手工台账.md、成团与导游管理.md、P0.1-组织隔离与结构化业务.md、独立站行程与报价V1.md；API 合同第15、16、18、21节。

现状：CI 使用 GitHub-hosted PostgreSQL16；部署 Dockerfile 执行 verify:release，因此隔离测试必须独立命令、独立 CI 步骤，不并入该脚本。仓库已有其他任务的 auth/cities/dictionaries/migration 变更与 backup ops 文件，保留。

实现：test/business-isolation.harness.ts 使用独立 ISOLATION_PG_* 参数、固定 localhost、随机临时库、完整迁移、finally 清理，忽略 .env 和 DATABASE_*；真实登录产生会话，后续使用真实 JWT/权限守卫/业务模块。HTTP 测试在 test/business-isolation.integration-check.ts；CI 使用现有临时 PostgreSQL 服务，但创建自己的随机库。测试装配不注册限流、运行监控与系统审计拦截器，业务服务的日志和事务保持真实。

本地验证（2026-10-23）：`pnpm test:isolation` 通过14组、556次真实HTTP检查；`pnpm exec eslint test/business-isolation.harness.ts test/business-isolation.integration-check.ts` 通过；最终 `pnpm exec tsc --noEmit --incremental false` 全项目通过。早期夹具/错误码预期已按迁移约束及实际合同修正，未修改业务实现。无需提交发布门禁，因为未提交或发布。

临时容器 travelops-isolation-20261023（127.0.0.1:55457）已停止并自动删除；停止前确认没有遗留 travelops_isolation_* 数据库。测试应用在finally关闭。未访问任何业务库。

修改文件：后端 test/business-isolation.harness.ts、test/business-isolation.integration-check.ts、package.json、.github/workflows/ci.yml、README.md、本恢复记录；共享说明 docs/deployment/业务隔离自测.md。verify:release、Dockerfile、deploy.yml和前端均未由本任务修改。CI仍沿用PR(main/dev)和push(main)触发，未推送，远程Actions尚未执行；自测不加入部署链路，但新测试文件受原有lint覆盖。

AOCI恢复：根 .aoci/drafts/business-isolation-20261023/maintain-response.json 与 guide.json。rc21普通Maintain仅调用一次，status=stopped/result=blocked、included=0、remaining=65；Guide stage=blocked/complete=false。pending_transactions=0、recovery_pending=false、third_party_conflict=false，无正式Entry Apply。混合集合包含前一轮备份/清理、本次CI和测试及其他权限任务；observe还含前端day-order.test.ts，孤儿为前端TODO-account-switch-presence.md。普通维护无本任务路径范围，按根规则不确认他人变动、不删除孤儿、不裁剪批次、不扩为全仓修复。业务结果完成，索引尚未对齐；后续独立维护依据最新Guide继续，不重跑本任务测试或备份操作。
