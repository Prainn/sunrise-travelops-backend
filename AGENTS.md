# Sunrise TravelOps Backend

先读 [workspace AGENTS](../AGENTS.md)；详细模块、数据流和数据库边界见 [架构 §4–8、§12](../docs/architecture/overview.md)。本文件保留后端开发与交付门禁，操作步骤见 deployment。

## Stack / Module Architecture

[package.json](package.json)：Node ≥24、NestJS 11/Express、TypeORM 0.3/pg、PostgreSQL 16（Compose/CI 默认）、JWT/Passport、Argon2、Swagger、Pino、class-validator/class-transformer。API 使用 Docker 内 Node 进程；Redis、BullMQ、PM2 当前未使用，不新增假设性的缓存或队列。

| 入口 | 职责 |
|---|---|
| `src/main.ts` / `src/app.module.ts` | 启动、全局管线与模块装配 |
| `src/auth` / `src/users` / `src/roles` | 当前登录身份、有效权限、账号管理；roles 注册实体，无独立角色管理 Controller |
| `src/inquiries` | 询盘、行程、成本试算、报价冻结、转交、调价、日志；没有独立 itineraries/quotations 模块 |
| `src/resources` / `src/system` | 七类资源及子价格/联系人；系统与业务字典 |
| `src/health` / `src/lynx` | Terminus 探测；独立公开访问记录（不混入业务 API/Swagger） |
| `src/config` / `src/database` / `src/migrations` | 环境校验、连接与 migration CLI、完整 schema 链 |

没有后端 dashboard 统计模块。不要根据业务名猜测模块目录。

## Backend Change Workflow

修改 endpoint 检查 Controller → DTO → Service → Entity/Repository 或结构化 SQL → migration（schema 变化时）→ Swagger → frontend caller；检查影响，不机械修改每一层。

修改 DTO、实体、服务调用或持久化 JSON 时，同步检查 contract、调用者、fixture、repository mock、seed、历史记录及 migration。类型断言不能证明运行时结构正确。Swagger 从代码生成，不代替根 API 合同。

## API Contract

详见 [共享 API](../docs/api/Sunrise%20TravelOps%20后端说明.md)。

- `/api`；普通成功由 `ResponseInterceptor` 包装 `{ code: "SUCCESS", message: "success", data }`，不在 Service/Controller 再包一层。204 无 body，文件和 health 成功响应有显式例外。
- `ApiExceptionFilter` 输出 `{ code, message, data: null, details, timestamp, path, requestId? }`；业务拒绝用 `BusinessException` 和现有 ErrorCode，保留真实 HTTP 4xx/5xx，不以 200 代替错误。
- 单资源不存在 404，空列表 200；分页 `{ list, total, page, pageSize }`。询盘范围外 ID 为 404，资源跨库拒绝可为 403，不能统一改写。
- GET/PUT 通常 200，未覆盖的 POST 默认 201；登录/刷新显式 200，退出等显式 204。新增动作核对 Controller 实际状态及前端消费者。
- 全局 ValidationPipe 负责白名单、拒绝多余字段及转换；DTO 嵌套校验不能替代 Service 的资源归属、状态和版本检查。

## Database / Business Invariants

- `synchronize:false`；应用启动不自动 migration。追加迁移，不修改已部署文件；新迁移冻结自己的转换定义，不导入会变动的运行时代码。
- Entity 与迁移保持映射一致，但 `structured-itinerary.ts` / `structured-quotes.ts` 的 SQL 明细表并非都有 Entity；完整 schema 看 migration，不能直接用 ORM 差异删除已有约束。
- 持久化变更检查旧数据及恢复路径，尤其 DROP、rename、type change 和 JSONB 转换；不直接修改生产 schema。日常业务不恢复 data JSONB 双写；冻结存档和审计 JSON 按现有设计保留。
- 金额沿用 numeric 与现有分币舍入工具、HTTP 两位小数字符串；迁移不得截断历史精度或用今天资源价伪造旧参考价。当前仅人民币，无汇率模型。
- `effectivePermissions` 以当前身份决定权限，不叠加其他身份；询盘按业务/负责人、资源按 library 校验，ROOT 也不能跨库引用行程资源。
- 每行程一份 V1 冻结报价，quoted 不可普通编辑，修改复制独立 Draft。冻结价格/数量/客户及计算结果不追随主数据更新；读取历史报价不得重新计算。
- 稳定明细 ID、父版本、业务保存、调价历史和日志保持事务一致；试算/取消/失败不记成功历史。内部成本、利润和调价原因不进入客户 PDF。

## Testing / Verification

- 开发迭代运行相关检查；准备提交或发布时，必须运行 `pnpm verify:release`：迁移命名检查、lint、build（已删除的单元测试不再执行；保留的e2e和数据库集成脚本不包含在此入口），与 CI 和 Docker build 使用同一个入口。不得用定向测试或 TypeScript 编译代替完整发布门禁。
- 修改 migration 时，除 CI 空库与重复执行，还必须用隔离数据库里的代表性旧结构/旧数据验证升级、约束及关键业务读取；不得对业务库直接试验。没有可用隔离环境时明确报告，不跳过后声称完成。

开发可按影响使用 `pnpm exec eslint <文件>`、`pnpm exec tsc --noEmit`、`pnpm exec jest --runInBand <测试文件>`；没有独立 type-check script。`pnpm build` 只构建，不能代替 verify:release。CI 另在 PostgreSQL 空库执行完整 migration 两次。

## Deployment / Data Safety

- 发布前读取目标环境 pending migrations 与当前版本，列出数据影响、兼容性及恢复方式。本地已执行迁移不代表服务器已执行。
- DROP、删除数据、不可逆 JSON 转换等破坏性迁移不得标记 `migrations_compatible=true`；必须先获得停写/备份/迁移/恢复方案授权。普通应用回滚不等于数据库回滚。
- 不默认清库。定向删除前确认环境、唯一 ID 和业务编号，备份后执行，删除后验证目标及关联记录；备份与凭据不能进入 Git。
- 环境变量、Secrets、DNS、TLS、Nginx/Compose、根权限部署脚本的变化需单独检查安装方式和验收，不能假设随业务镜像自动更新。
- 触及历史兼容标记时先核实其依据；本环境曾把破坏性规划迁移误登记为兼容，修正服务器状态并验证数据库前，不允许回滚到该结构变更前的应用。

## Release Acceptance

- 获授权 push 后，以 repo、branch、准确 SHA 找到对应 Actions run，用 `gh run watch --exit-status` 或 GitHub API 等待 verify/deploy 最终结果；不能 push 完就结束。
- 失败、取消、等待人工操作均不算成功。及时报告阶段、运行链接、错误摘要及当前仍在线的版本。
- 成功后核对服务器实际发布 ID/镜像、`/api/health`、前端入口，以及本次变动的关键业务路径（特别是旧询盘/行程读取）。health 为 up 只表示运行探测正常，不证明最新发布成功或业务正确。
- 优先直接查 Actions，不以邮箱是否收到通知判断成功；Gmail 仅辅助。任务结束时报告已部署/尚未部署/部署失败的真实状态。
- 状态页和告警需实际验证异常、恢复、数据过期。未配置通知渠道或未投递验证，不得称“监控已上线”。AGENTS.md 是执行规则，不是后台监控服务。

详细步骤：[ECS 环境](../docs/deployment/ECS开发环境部署.md)、[后端发布/回滚](../docs/deployment/后端自动部署.md)、[独立状态页](../docs/deployment/独立状态页.md)；执行入口为 `.github/workflows/ci.yml`、`.github/workflows/deploy.yml`、`scripts/deploy.py`、`ops`。

## Documentation

按根文档规则同步受影响合同及架构；涉及身份、结构化存储、冻结/调价约束时核对 [P0.1](../docs/requirements/P0.1-组织隔离与结构化业务.md)。环境发布结果留在部署/验证记录，不把动态在线 SHA、迁移执行状态或命令清单写入本文件。

## Branch and Delivery

日常修改在 dev；dev push 发布开发环境，main 必须 PR 且检查通过后手动发布 prod。公开仓库的 PR 检查不得进入 ECS self-hosted runner。根部署命令只用于 dev。基础设施切换完成前以 deployment 的实际记录为准，不能因配置已提交就宣称 runner 或分支保护已生效。
