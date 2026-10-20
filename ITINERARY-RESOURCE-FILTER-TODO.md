# 行程重构：独立站公共资源城市筛选

范围：后端 `GET /api/website/resources/:kind` 增加城市筛选，同步根 API 合同及必要需求说明；前端由另一个 agent 负责。用户已授权提交并部署开发环境；不改业务库或 schema，AOCI 等前端完成后统一对齐。

- [x] 核对当前 dev 工作区、Controller / DTO / Service、前端消费者和根合同。
- [x] 更新合同并实现可选 `city` 参数；按城市与关键词共同过滤后计数、分页。
- [x] 定向校验参数、筛选 SQL、分页与权限边界，运行受影响 ESLint 和 TypeScript 检查。
- [ ] AOCI 收尾：用户明确要求等待前端完成后统一对齐；此前停点见文末。
- [x] 交付前端接入说明；代码与合同已完成。
- [x] 发布前完整 `pnpm verify:release` 通过，核对 dev 在线版本和 64 条已执行迁移；本次无待执行迁移。
- [~] 提交并通过现行 dev Actions 发布；实时进度及最终结果见根 `docs/deployment/2026-10-20-website-resource-city-dev.md`，避免记录发布结果再次触发应用部署。

## 实现决定

- 公共酒店/餐厅的 `city`、公共景点的 `area` 目前保存城市名称；新参数使用去首尾空白后的公共城市名称精确匹配，不能传独立站配置城市 UUID。
- `city` 缺省或空白不筛选；仅 hotel / restaurant / attraction 支持非空城市条件，city / transport 带非空条件返回 400 BAD_REQUEST。
- 保持现有 `website:config:list` 和允许身份范围、公共资源启用/未删除条件、响应结构与价格要求，不改业务归属或配置版本。
- 独立站配置城市与公共城市关系只能沿已有 resourceId 显式关联；本接口不猜名称映射。
- 既有顺序持久化、末日 `overnightCityId=null` 和车型人均售价结构无需更改。

## 证据与接续入口

- `src/website/website.controller.ts` 的 resources 路由。
- `src/website/website.dto.ts` 的 WebsiteResourceQuery。
- `src/website/website.service.ts` 的 resources。
- 根 `docs/api/Sunrise TravelOps 后端说明.md` 第 18 节。
- 前端当前 `websiteService.resources` 只发送 page/pageSize/keyword；本任务不修改该消费者，交付新增参数供并行前端接入。

## 验证

- `pnpm exec eslint src/website/website.dto.ts src/website/website.service.ts src/website/website-resources.spec.ts --fix`：通过；diff 仅本次改动。
- `pnpm exec jest --runInBand src/website/website-resources.spec.ts`：19/19 通过。覆盖三类资源、城市与关键词组合、分页和筛选总数、空值、SQL 参数绑定、参数拒绝及现有权限边界。
- `pnpm exec tsc --noEmit --incremental false`：通过。
- 测试使用 mock 数据库和真实 ValidationPipe，不读取环境变量或连接任何业务库；未做真实数据库/HTTP 联调。
- 首轮开发未进入发布阶段；用户授权发布后已补跑完整 `pnpm verify:release`（迁移命名、全量 lint、build）并通过。未新增迁移。

## 前端接入

- `GET /api/website/resources/hotel?city=昆明&page=1&pageSize=20&keyword=酒店`；restaurant / attraction 同样支持。
- city 为公共城市名称，前端通过查询参数编码发送。获取公共城市用 `GET /api/website/resources/city` 分页结果中的 name；专属城市 UUID 不可直接用作 city。
- 清除筛选时省略 city 或传空字符串；更换城市重置 page=1，服务端 total 已按城市和关键词过滤。
- 原有不带 city 的调用保持可用，前端业务代码由并行 agent 修改。
- 完整权威约定已同步根 API 合同第 18 节，而非另建接口合同。

## AOCI 停点（2026-10-20）

- 已读取当前 aoci_rules，源码稳定后调用一次 aoci_maintain；服务版本 0.1.0-rc12，返回 `status=stopped/result=blocked`，候选为空，未 Apply。
- 当前阻断为 `observed_pending`：交接包 7 张图片和新测试，共 8 个观察对象需复核。scope status 与 Guide 确认 `stage=blocked` / `observed_evidence_review_required`。
- 计划同时混入与本次无关的 `docs/verification/2026-10-20-ledger-conflict-codes.md` 漂移，以及先前交接 prompt 的缺项。普通 maintain 的 scope 仅支持卷级；object_refs 只供 aligned 状态的 cognition_optimization，不能用于本次裁剪批次。
- Maintain 治理证据：`pending_transactions=0`、`recovery_pending=false`、`third_party_conflict=false`；没有待恢复的正式写入，不执行 scope acknowledge 或修改无关条目。
- 待继续逻辑计划：`68c9ac660c927d05881625af2a9af05019492cd39d7f608c8f84965d06eed448`，未签发候选批次 `1d378089d1e13938710920c96ba37d104cb845400882251dad5ce44151c348e0`（included=0、remaining=7）。后续状态变化须重新读取 Guide，不能复用旧批次写入。
- 独立维护入口：`/Users/joe/.local/share/aoci/0.1.0-rc12/aoci index agent guide --agent codex --json`，按实际 Guide 复核 Observe 与完整候选；本次不扩大为全仓维护。
