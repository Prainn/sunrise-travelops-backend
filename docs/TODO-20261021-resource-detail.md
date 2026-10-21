# 公共资源按 ID 查询

- [x] 核对列表接口、权限及前端 resource-cities.ts：公共城市仅首页、餐厅按历史名称搜索存在漏查。
- [x] 增加 GET /api/website/resources/:kind/:id，更新根 API 合同和权限绑定。
- [x] 扩展并运行隔离的定向自动化测试及角色权限检查。
- [!] AOCI 收尾受历史漂移阻塞；已记录恢复入口。
- [x] 前端接入说明已准备，在当前对话交付。

## 范围与选择

仅后端接口、对应合同、测试及权限检查绑定；不改前端、不提交、不部署、不操作业务库。保留开始时已有未提交改动（website service/DTO/engine/types、集成脚本及迁移）。

复用现有 kind 白名单与 website:config:list 权限，限定 linxi/website/headquarters。按 ID 精确查询未删除公共资源，返回现有简要字段和 status；允许读取停用资源以核对历史引用，不改变新增选择或保存的资源有效性规则。不存在/已删除为 404，不按名称兜底。

证据：src/website/website.service.ts 的 resources/permission，src/website/website.controller.ts；前端 src/views/website-inquiries/itineraries/resource-cities.ts。根合同 docs/api/Sunrise TravelOps 后端说明.md 第 18 节。

## 实现与测试结果

修改：后端 website.controller.ts / website.service.ts / website-resources.spec.ts，根 API 合同、scripts/check-role-permissions.cjs。

`pnpm exec jest --runInBand src/website/website-resources.spec.ts`：35/35 通过（含16项新增HTTP/服务行为测试；模拟数据库，无业务库连接）。首次测试发现测试夹具缺少 ResponseInterceptor 的 Reflector 参数，已修复后通过。

`node scripts/check-role-permissions.cjs`：通过，185 endpoints / 25 routes / 14 role-scope cases。未运行全量检查、构建、远程联调或部署。

## AOCI 停点

2026-10-21 aoci_maintain 返回 stopped/blocked，混入台账、成团、询盘字段等无关历史漂移；total_targets=65，included=0，无候选签发。logical_plan=e504f848be0529c834a863709afee7670f63ef7678c01510855543872b84a396；batch_identity=c837ce7e07446209901be12ae3015cfe0a4d4708fc0565b2aec1c21455d8ec9f。pending_transactions=0、recovery_pending=false、third_party_conflict=false，无本任务未决写事务。本次未提交索引 Apply，不扩为全仓治理。普通维护 Schema 无按本任务路径筛选能力（object_refs 仅支持已对齐后的 cognition_optimization）。独立维护任务从当前 Guide/Scope 状态解决历史漂移后继续；索引尚未对齐。

接口已在本地实现且定向测试通过；尚未提交或部署，前端 Agent 可按根合同接入，但不能假定远程 API 已上线。
