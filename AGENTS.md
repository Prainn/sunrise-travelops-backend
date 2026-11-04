# Sunrise TravelOps Backend

遵守[根导航](../AGENTS.md)；已有内容不重复读。下面是按任务入口，不要求读取全部链接。

## Stack / Module Architecture

[package.json](package.json)：Node ≥24、NestJS 11/Express、TypeORM 0.3/pg、PostgreSQL 16（Compose/CI 默认）、JWT/Passport、Argon2、Swagger、Pino、class-validator/class-transformer。API 使用 Docker 内 Node 进程；Redis、BullMQ、PM2 当前未使用，不新增假设性的缓存或队列。

| 入口 | 职责 |
|---|---|
| `src/main.ts` / `src/app.module.ts` | 启动、全局管线与模块装配 |
| `src/auth` / `src/users` / `src/roles` | 当前登录身份、有效权限、账号管理；roles 注册实体并提供 ROOT 专用菜单配置，不提供角色 CRUD |
| `src/inquiries` | 询盘、行程、成本试算、报价冻结、转交、调价、日志；没有独立 itineraries/quotations 模块 |
| `src/website` | 独立站直客询盘、行程、人工报价与专属配置；统一 API 合同第 18 节 |
| `src/tours` / `src/common/tour-lock.ts` | 成团、导游请假/评分及来源写入锁；实际人员与报价服务价格分离 |
| `src/dashboard` | 首页只读聚合；复用询盘、独立站、成团及请假 Service 的范围逻辑 |
| `src/resources` / `src/system` | 公共资源、航班、独立导游人员及组团社联系人；系统与业务字典 |
| `src/operation-logs` | 系统管理操作日志；与询盘差异/调价历史独立 |
| `src/health` / `src/lynx` | Terminus 探测；公开归因登记/Resolver及JWT访问记录台账；公开接口与业务接口认证独立 |
| `ops/lynxtour-visits` | 原独立只读表格部署及退役入口；现行访问记录台账见统一 API 合同第 20 节 |
| `src/config` / `src/database` / `src/migrations` | 环境校验、连接与 migration CLI、完整 schema 链 |

不要根据业务名猜测模块目录。

## 任务路由

| 任务 | 必读范围 |
|---|---|
| 接口、DTO、Service 或调用链修改 | [开发规范](docs/agent-guides/development.md)的 Backend Change Workflow、API Contract、Documentation + 根 API 对应章节及实际消费者 |
| schema、持久化 JSON、权限隔离、冻结/金额或事务 | [开发规范](docs/agent-guides/development.md)的 Database / Business Invariants + 受影响源码/迁移/需求；不因此全量读索引 |
| 验证或测试 | [验证规范](docs/agent-guides/release.md#testing--verification) + [共享验证边界](../docs/agent-guides/workflow.md#validation) |
| 获授权提交、发布、回滚或业务库操作 | [发布规范](docs/agent-guides/release.md)命中章节；部署再读其中目标环境资料与适用发布 Skill |
| 模块关系仍不清楚 | [架构 §4–8、§12](../docs/architecture/overview.md)中的相关章节；明确调用链的小修改不预读 |

## 不可绕过的门禁

- 后端提交或发布前必须通过完整 `pnpm verify:release`，定向检查不能替代。
- 任何生产发布前，待发布后端版本必须通过 `pnpm test:isolation`；使用隔离 PostgreSQL，不连接业务库。操作见[业务隔离自测](../docs/deployment/业务隔离自测.md)。
- 修改权限或任何生产发布前，按[共享门禁](../docs/agent-guides/workflow.md#权限与生产门禁)运行根 `node scripts/check-role-permissions.cjs`。
- `synchronize:false`；追加迁移，不修改已部署迁移；运行时 Entity 不代替完整 schema 链。迁移修改的隔离升级验证见验证规范。
- API 变更同步唯一根合同及前端实际消费者；业务归属/动作权限在服务端验证。纯局部改动不机械检查无关模块。
