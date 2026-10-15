# 菜单权限与霖熹独立站询盘接入

边界：仅本地实现与必要验证；不提交、推送、部署、浏览器验证或访问业务库。允许本地隔离 PostgreSQL 测试。不增加依赖。

- [x] 核对受影响合同、认证/路由、website 配置与业务归属、成团及账号影响链；确定合同和迁移。
- [x] 实现角色菜单配置、ROOT 管理接口及登录会话菜单快照。
- [x] 实现霖熹接入及业务/配置/负责人/成团隔离。
- [x] 实现前端菜单权限页、菜单和隐藏路由守卫、业务范围上下文。
- [x] 完成必要定向验证、同步需求/API/架构文档。
- [!] AOCI 收尾阻塞：已记录当前范围及恢复入口，未扩展处理登录页历史漂移。

## 已确认规则

菜单权限只限制页面访问，不更换现有操作权限来源。公共菜单按角色共享；盛旭普通询盘，霖熹/独立站共用独立站流程并隔离数据；总部按原角色权限。仅总部 ROOT 管理。ROOT/基础页面固定开放。菜单修改仅重新登录生效，刷新页面/令牌保持登录快照。霖熹无旧普通询盘，不转换旧数据。

## 起始状态

两仓 dev；前端 ahead 1，工作区干净；后端工作区干净。保留已有提交，不改历史。

## 恢复入口

本文件；对应根 docs/API、src/auth、src/website、src/tours、src/users，前端 router/stores/system/website 页面及 scripts/check-role-permissions.cjs。

## 实现选择

access/refresh JWT 签名携带菜单快照，refresh 沿用快照；角色与接口权限仍每请求实时校验。角色菜单独立 SQL 表，ROOT 双重权限及身份校验。website 询盘/行程/配置版本补 business_unit，复合外键保护跨业务引用；保留历史全局配置版本 ID，以序列分配新 ID，linxi 为空初始化。对应合同已先更新。新迁移 1792051200000，不支持未经评审的自动回滚。

## 验证进度

前端类型检查通过；首轮后端类型检查发现 fixtures 缺少新菜单/归属字段，已补齐，最后一个 direct AuthService caller 已修。根权限脚本通过（163 endpoints/23 routes/14 role-scope cases）。未访问既有 localhost:5432 容器；新建任务专属 sunrise-menu-scope-test，端口 55441，临时 postgres 数据，无业务库连接。下一步编写单一隔离升级/鉴权/会话/业务集成入口并验证、lint 定向自动修复。

隔离集成首轮因加载全部 Entity 命中已有 InquiryLogEntity union metadata，不修改无关实现，改为仅注册本任务所需实体；测试账号通过既有 resetPassword 流程准备。路由/守卫 15 项和角色有效权限 15 项已通过。当前集成重跑 session 82863；后端类型检查修复 fixture 方法入参和 DTO 完整字段，待最终重跑。


## 最终验证与状态

- 后端受影响文件 ESLint、`pnpm exec tsc --noEmit`、迁移命名检查通过。
- 前端受影响文件 ESLint、`pnpm type-check` 通过；路由/守卫定向测试 15 项通过。
- 后端角色权限/独立站 engine 定向测试 20 项通过；现有 Auth HTTP e2e 2 项通过（内存 fixture，无业务库）。
- 根 `node scripts/check-role-permissions.cjs` 最终通过：163 endpoints、23 protected routes、14 role/scope cases、1 resource create action。
- `test/menu-scope.integration-check.ts` 通过：空库/重复迁移、旧结构升级、冻结 JSON 及历史配置保留、ROOT 管理/并发版本/审计、登录与 refresh 快照、多角色菜单并集/范围上限、两业务列表/计数/详情/负责人/转交/配置版本及复合外键、成团继承业务、未完成询盘停用/删除/角色撤销保护。
- 初轮失败均为测试 fixture：全部 Entity 加载触发既有 InquiryLogEntity metadata；已限定到实际所需 Entity。航班缺少机场数据；已在临时库补合法测试机场及外键。最终通过。
- 历史调用 fixture 同步新 menuKeys JWT 与 business_unit、总部配置上下文和全局版本语义；未运行其无关历史完整脚本。
- 两仓 `git diff --check` 通过。测试生成的自动导入文件已恢复原状；任务专属 55441 PostgreSQL 容器已停止并删除，脚本临时库 finally 清理。
- 未进行浏览器验证、commit/push/deploy 或业务库操作。新迁移尚未应用到任何业务环境；没有菜单快照的旧 token 在启用此版本后需重新登录。

## AOCI 未对齐与继续入口

最终维护（运行 MCP 0.1.0-rc12）返回 `stopped/blocked`，`candidates=[]`，未签发可写批次；无 pending transaction、Recovery 或第三方冲突，network_accessed=false，未写正式 Entry/Baseline。随后 Guide 返回 `stage=blocked`、`observed_pending`，待复核本任务改动的测试证据。

维护 logical_plan `44a138485f5e586d17fde2a97f02c6332a9f304586fd32872051a23f8d062885` 混入本次未修改的 `sunrise-travel-ops-web/src/views/login/index.vue` 历史 stale。普通 Maintain 没有路径级筛选；`object_refs` 仅供已 aligned 的 cognition_optimization，不能用于此场景。按根 AGENTS 的无关历史漂移边界，本次不裁剪批次、改 Scope 或重写无关登录页索引。

独立维护任务恢复：先核对实际源码与当前 Guide，复核 observed 测试集合后按 Guide 的 scope acknowledge 处理；重新领取当前完整机器批次，依据完整源码证据创作并 Apply，完成 Verify/Check/Guide。上述旧 plan/批次身份只用于定位，源码及 TODO 已变化，不复用作写入凭据。
