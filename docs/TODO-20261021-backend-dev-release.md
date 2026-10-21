# 当前后端 dev-fast 发布

- [x] 核对当前 dev 工作区、远端、工作流和 dev 运行状态。
- [x] 审阅全部待发布改动及迁移，完成受影响 ESLint / TypeScript 快速门禁。
- [~] 提交当前后端、推送准确 dev SHA；绑定该 SHA 发布任务。
- [ ] 候选镜像构建；持全局锁停止 dev API，备份 travelops_dev 后事务执行待迁移集合并切换。
- [ ] 核对实际镜像、发布记录、迁移名称及 health；更新交付记录。

## 授权与目标

用户明确要求提交当前后端并部署 dev，显式调用 dev-fast；包含当前未提交改动及已提交未推送的 ea5fc1c。仅后端 dev，不触碰生产或发布前端。当前 workflow 的 dev push 对应 dev、main 手动对应 prod，因此使用 dev，不照技能旧 main 表述操作生产分支。当前 skill 授权较轻本地门禁，不运行本地全量 verify:release 或额外测试；工作流自身门禁按现状执行。

目标 47.114.79.126 /opt/sunrise-travelops-dev / travelops_dev，已通过 SQL current_database() 核实。发布前 current=65a161d33c9f0d5d9bfda5bf78188e6f085d78e1-39394555690-1，容器 healthy，镜像 sha256:04d73f377e0d993d37a1511005416d7525b6fbdf0a38fa3ad07fb6416feaa918。origin/dev=65a161d，origin/main=9bf4ead，仅记录分支位置，不访问生产。

## 待迁移审阅

现有65条，候选68条：
- UpdateDirectLedgerWorkflow1792713600000：删除审核与成团耦合 CHECK；保留数据，但新流程不支持直接回旧约束，按 breaking 管理。
- AddTourAgencyReference1792800000000：增加可空 agency_id 外键，兼容性添加。
- UpdateWebsiteInquiryFields1792886400000：phone 改名 contact_info，删除旧 email/询盘抵达离开时间，新增登记字段和编号登记表；明确 breaking，需匹配前端。行程自身交通时间保留。

不使用 reviewed_migrations 将 breaking 在线放行。构建期间保持原 API；构建完成后持共享 build.lock，重新核对 dev SHA/目标库/待迁移集合，停止 dev API，私有目录保存一次非空 pg_dump 和旧 env/state，事务运行完整待迁移集合，再调用当前 deploy.py 发布准确候选。失败先查询迁移实际状态；事务未提交可恢复旧 API，提交后保持停写，必要时从该备份恢复精确 dev 库及旧 env/state/镜像，不能只回滚应用。备份和凭据不入 Git。

当前 ECS 自托管 BuildKit 为实际发布路径；旧上传入口停用，使用现行路径而不新建传输机制。

## 本地快速门禁

受影响26个 TypeScript 文件 ESLint 与 pnpm exec tsc --noEmit 最终通过。资源详情 HTTP 测试新增代码的格式及 Nest HTTP server/响应断言类型已修复。未运行本地测试/全量verify；预期自动工作流执行既有 scripts/test_deploy.py 和 Dockerfile 内 verify:release。scripts/deploy.py 将两条 breaking 纳入禁止在线兼容放行/跨迁移回滚集合。
