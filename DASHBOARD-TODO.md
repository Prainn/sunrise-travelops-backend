# Dashboard 只读统计（2026-10-19）

- [x] 核对模块、合同、现有 actor/scope、日期约定及前端接入边界。
- [x] 新增 DashboardModule，复用所属 Service 的范围逻辑执行 COUNT/GROUP BY；同步需求、API、架构。
- [x] 验证权限缺失、各身份范围、日期边界、补零与参数校验；运行受影响 lint/type/test 和权限核对。
- [!] 最终稳定后已调用 AOCI 维护；混入前端无关漂移且普通维护不支持路径限域，留待独立维护任务。业务接口与前端对接 prompt 已完成。

## 已确认口径

当前身份可见范围；新增询盘趋势合计普通与独立站可访问来源，按创建日期、不限当前状态；Asia/Shanghai 周一至周日；趋势含今天，默认7天，仅7/30；成团按 start_date、仅 active；请假统计记录数、日期两端包含。无权限整项 null，有权限无数据为0；趋势两来源均无权时 newInquiries=null。实现阶段仅后端与根 docs、不连接业务库。随后用户明确授权提交并部署后端到开发环境；不修改/发布前端或生产。

## 证据和实现选择

- InquiriesService.queryInquiries/scopeInquiryQuery 与 actor 为普通询盘列表统一入口。
- WebsiteService.list 当前内联 businessUnit/owner 条件，提取共享范围方法供列表与聚合调用；保留 scope+permission 双校验。
- ToursService.visible 供列表与聚合共同调用；GuideLeavesService 沿用公共 FROM/未删除条件。
- 全局 JwtAuthGuard 负责认证；PermissionsGuard 对未声明权限的登录端点放行，各统计项单独检查现有列表权限，不增加 dashboard:view。
- 根 docs/api 第16节与 architecture 时间约定支持 start_date、Asia/Shanghai 和公共请假范围。

## 验证及下一步

- 已修改：src/dashboard（模块/控制器/DTO/服务/权限组合及scope测试）、app.module、inquiries服务/模块、website服务、tours服务/请假服务/模块、test/dashboard.e2e-spec.ts、后端AGENTS导航，以及根API/P0/architecture。
- 最终已通过：受影响 ESLint、`pnpm exec tsc --noEmit`、`git diff --check`；`pnpm exec jest --runInBand src/dashboard`（54项）；`pnpm exec jest --config test/jest-e2e.json --runInBand test/dashboard.e2e-spec.ts`（14项）；`node scripts/check-role-permissions.cjs`（165端点、23路由、14身份组合）。
- 测试均不加载AppModule/环境或连接数据库；SQL范围测试使用真实TypeORM元数据与PostgreSQL QueryBuilder，比较列表和聚合的组织/负责人/参与人条件；HTTP测试使用真实JWT策略/守卫、ValidationPipe、响应信封与Swagger，替换用户查询和聚合结果。
- 本机Docker socket不存在（Docker未运行），没有真实PostgreSQL执行验证；未尝试业务数据库或生产。无业务数据/schema写入、无迁移、无提交/推送/部署。

## AOCI 未对齐与恢复入口

- 维护返回 stopped/blocked，候选数组为空，total_targets=21/included=0；logical_plan=`73c1a8a94768305bd63d885e0915ef671a59aed1e399fc7d8dd362dd2a6007c9`，batch_identity=`d4b4c16faa2b4d8fed9356825d38b94d39488785406047118f939e8576c8f949`。未提交任何 Entry 创作或 Apply。
- 响应证明 pending_transactions=0、recovery_pending=false、third_party_conflict=false、network_accessed=false；无本次未决正式写事务。
- 除本次源码/合同外，stale 混入 frontend en.json、zh-cn.json、views/system/operation-logs/index.vue、types/components.d.ts。按根AGENTS边界，不修改这些条目，不裁剪完整机器批次，不扩成全仓修复。
- scope status 确认 stage=observed_evidence_review_required，observed_pending_review=2（本次新增两份 .spec.ts）；ordinary maintain schema 仅支持 domain scope，无路径过滤，object_refs仅限已对齐的cognition_optimization，不适用于此处。
- 独立维护继续入口：读取最新Guide/工具Schema；先检查并审阅scope观察项，再重新领取完整机器批次（旧ID仅供恢复定位，不盲目复用）。实际CLI为 `/Users/joe/.local/share/aoci/0.1.0-rc12/aoci`；可从 `scope status --json` 与 `scope acknowledge --help` 查阅当前规则。不要因本次已交付而宣称索引对齐。
- 本任务测试进程均已退出，HTTP测试app在afterAll关闭；后续前端可按根API第17节接入，当前后端尚未部署。

## 后续开发发布授权

- 用户已授权本次后端提交、推送dev并部署开发环境。完整 `pnpm verify:release`（迁移命名/lint/build）已通过。
- 发布前只读确认 `/opt/sunrise-travelops-dev`、`travelops_dev`；当前版本 be245b900099c33c80a04290c5adba2e1ae2003c，容器healthy，迁移61项，与候选完整链一致，无待执行项。
- 发布动态进度和最终SHA/Actions/线上版本记录在根 `docs/deployment/2026-10-19-dashboard-dev-release.md`，不为记录结果追加无业务变更的发布提交。
