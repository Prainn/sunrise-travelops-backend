# 新增账号自动建议团号标识

- [x] 核对用户表单、用户管理接口、字段格式与既有成团消歧规则。
- [x] 更新需求/合同，实现后端建议接口及前端可编辑自动填充。
- [x] 定向测试、两端类型/lint、权限绑定校验。
- [!] AOCI 收尾已检查：维护受其他任务 Observe 漂移阻塞，索引尚未对齐，见下方恢复入口。

范围：用户最后说明三个现有生产账号由其自行修改，本任务不操作生产数据，不提交/推送/发布。新增用户按英文名首字母＋姓氏拼音首字母建议；占用时逐字延长英文名前缀，总长不超过10位。既有账号不重编，人工输入不覆盖。用户追加要求保存时禁止重复：新增/编辑均在事务内获取目标标识 advisory lock 后全库查重，排除编辑本人；返回独立409错误。无需迁移，不自动清理历史重复。

实现：当前无拼音库，后端引入 pinyin-pro 的姓氏模式（官方说明 https://pinyin-pro.cn/use/pinyin.html），处理中文姓氏而非猜测用户名。后端只查询候选标识是否被未删除账号使用，返回单个建议，不返回账号资料。无法提取姓氏/英文字母或候选耗尽返回空建议并提示手填。前端只在新增且未人工修改时请求，丢弃过期响应，编辑模式保持原值。

证据入口：src/users/user-management.controller.ts、user-management.service.ts、dto/user-management.dto.ts；前端 src/views/system/user/index.vue、src/services/user.service.ts、src/types/user.ts；根 docs/requirements/成团与导游管理.md、docs/api/Sunrise TravelOps 后端说明.md。接口为只读建议，不预留标识、不新增唯一约束；业务账号创建/编辑仍显式提交最终值。

追加范围：总部账号字段隐藏且不自动生成/必填，新建空值存null、更新省略保留旧值；已有生产总部账号不批量清空。按目标账号身份判断。总部显式传非空值仍查重；成团的创建人标识要求未修改。

验证：两端受影响文件 ESLint、后端 `pnpm exec tsc --noEmit`、前端 `pnpm type-check`、两仓 `git diff --check` 均通过。后端 tour-code 与 user-management.service 的 Jest 共15项通过；前端建议逻辑与用户 service 共8项通过。根 `node scripts/check-role-permissions.cjs` 通过（186个接口、25个受保护路由、14个角色/范围用例）。

隔离 PostgreSQL 集成：`pnpm exec ts-node test/user-tour-code.integration-check.ts` 通过，覆盖创建/编辑冲突及回滚、并发创建/编辑、排除本人、跨范围及停用账号占用、软删除复用、候选扩展/耗尽、总部可空/保留旧值/显式值查重。仅使用本地临时 PostgreSQL 16 容器 sunrise-user-tour-code-test-20261021（端口55461、tmpfs数据）；测试后已删除容器，无业务库写入。未执行浏览器视觉验收或发布门禁（本任务不提交/发布）。

收尾核对发现前端 tours/TourEditorDialog.vue、tour-form.ts、tour-form.test.ts 有其他任务改动，未修改或回退。

AOCI 收尾（2026-10-21）：`aoci_maintain({})` 返回 stopped/blocked，candidates 为空，logical_plan=a738c32327e1449c4cc0e0748f5c412342bbab568429a26d53a7796f3a16463b，total_targets=22、included=0、remaining=22。Guide 确认 observed_pending，涉及本任务测试以及其他任务 tour-form.test.ts；普通维护与 scope acknowledge 均无按本任务路径缩小的参数（后者仅有 reviewed-by，复核全部待处理 Observe）。同时混有 tour pickup 文档及前端成团改动，按根 AGENTS 范围边界不扩为跨任务修复、不裁剪候选、不确认未复核的其他任务。工具确认 pending_transactions=0、recovery_pending=false、third_party_conflict=false，本次未提交索引写入，无待决写事务。待独立维护任务复核完整 Observe 集合后，按 `/Users/joe/.local/share/aoci/0.1.0-rc12/aoci index agent guide --agent codex --json` 续接，再领取完整维护批次并完成 verify/check/guide。业务实现与定向验证已完成，索引对齐未完成。
