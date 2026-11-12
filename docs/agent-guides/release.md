# 后端验证与发布

开发验证只读 Testing / Verification；提交时执行完整提交门禁；获授权发布或业务库操作时再读后续章节及目标环境部署资料。

## Testing / Verification

- 开发迭代运行相关检查；准备提交或发布时，必须运行 `pnpm verify:release`：迁移命名检查、全量 lint、build（现有单元测试、e2e 和数据库集成脚本不包含在此入口，开发时按实际影响另行运行）。PR CI 和 dev 普通发布的 GitHub 托管门禁均使用同一入口；dev ECS 仅对已通过门禁的准确提交执行镜像内迁移检查和编译。生产发布、运行时刷新和直接 Docker 构建沿用镜像内完整检查。不得用定向测试或 TypeScript 编译代替完整发布门禁。
- 用户要求部署到生产时，发布前必须针对待发布的后端版本运行 `pnpm test:isolation`，通过后再执行生产发布；不能用其他版本或历史通过结果替代。使用一次性隔离 PostgreSQL，不连接业务库；失败或无法执行时报告原因并暂停生产发布。操作见[业务隔离自测](../../../docs/deployment/业务隔离自测.md)。这是 Agent 发布前门禁，不并入开发部署、`verify:release`、Docker build 或部署 workflow。
- 修改 migration 时，除 CI 空库与重复执行，还必须用隔离数据库里的代表性旧结构/旧数据验证升级、约束及关键业务读取；不得对业务库直接试验。没有可用隔离环境时明确报告，不跳过后声称完成。

开发可按影响使用 `pnpm exec eslint <文件>`、`pnpm exec tsc --noEmit`、`pnpm exec jest --runInBand <测试文件>`；没有独立 type-check script。`pnpm build` 只构建，不能代替 verify:release。CI 另在 PostgreSQL 空库执行完整 migration 两次。

## Deployment / Data Safety

- 发布前读取目标环境 pending migrations 与当前版本，列出数据影响、兼容性及恢复方式。本地已执行迁移不代表服务器已执行。
- DROP、删除数据、不可逆 JSON 转换等破坏性迁移不得标记 `migrations_compatible=true`；必须先获得停写/备份/迁移/恢复方案授权。普通应用回滚不等于数据库回滚。
- 不默认清库。生产业务数据清理须遵守[共享改动边界](../../../docs/agent-guides/workflow.md#改动边界)的具体记录清单单独确认规则，不能并入发布或清理旧数据的笼统授权。定向删除前确认环境、唯一 ID 和业务编号，备份后执行，删除后验证目标及关联记录；备份与凭据不能进入 Git。
- 环境变量、Secrets、DNS、TLS、Nginx/Compose、根权限部署脚本的变化需单独检查安装方式和验收，不能假设随业务镜像自动更新。
- 触及历史兼容标记时先核实其依据；本环境曾把破坏性规划迁移误登记为兼容，修正服务器状态并验证数据库前，不允许回滚到该结构变更前的应用。

## Release Acceptance

- 生产发布按 `deploy-production` Skill 和[需求维护规范](../../../docs/agent-guides/requirements.md)的 CRF 规则执行：发布前核对本次新旧需求变更，发布核验后回填实际交付条目的上线时间。小 UI 调整和按原需求修复的 bug 不登记 CRF。
- 获授权 push 后，以 repo、branch、准确 SHA 找到对应 Actions run，用 `gh run watch --exit-status` 或 GitHub API 等待 verify/deploy 最终结果；不能 push 完就结束。
- 失败、取消、等待人工操作均不算成功。及时报告阶段、运行链接、错误摘要及当前仍在线的版本。
- 成功后核对服务器实际发布 ID/镜像、`/api/health`、前端入口，以及本次变动的关键业务路径（特别是旧询盘/行程读取）。health 为 up 只表示运行探测正常，不证明最新发布成功或业务正确。
- 优先直接查 Actions，不以邮箱是否收到通知判断成功；Gmail 仅辅助。任务结束时报告已部署/尚未部署/部署失败的真实状态。
- 状态页和告警需实际验证异常、恢复、数据过期。未配置通知渠道或未投递验证，不得称“监控已上线”。AGENTS.md 是执行规则，不是后台监控服务。

详细步骤：[ECS 环境](../../../docs/deployment/ECS开发环境部署.md)、[后端发布/回滚](../../../docs/deployment/后端自动部署.md)、[独立状态页](../../../docs/deployment/独立状态页.md)；执行入口为 `.github/workflows/ci.yml`、`.github/workflows/deploy.yml`、`scripts/deploy.py`、`ops`。

## Branch and Delivery

日常修改在 dev；dev push 发布开发环境，main 必须 PR 且检查通过后手动发布 prod。公开仓库的 PR 检查不得进入 ECS self-hosted runner。根部署命令只用于 dev。基础设施切换完成前以 deployment 的实际记录为准，不能因配置已提交就宣称 runner 或分支保护已生效。
