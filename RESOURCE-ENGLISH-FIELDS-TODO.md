# 公共资源英文信息（2026-10-15）

- [x] 核对并更新需求/API 合同，新增可选英文名（三类资源）和英文描述（餐厅/景点）。
- [x] 实现迁移、DTO/Entity/Service、前端类型/请求映射/表单及列表。
- [x] 运行定向 lint、类型检查及隔离库升级/重复执行/旧数据读取验证。
- [!] AOCI 收尾被无关历史漂移阻塞，业务实现和验证已交付。

## 范围与依据

- 根 docs/requirements/Sunrise TravelOps P0需求说明.md §4；docs/api/Sunrise TravelOps 后端说明.md §8–10。
- 现有资源均使用平面 CRUD；新字段使用 englishName / englishDescription，空值沿用可选文本的空字符串约定；不改变行程、冻结、价格或权限规则。
- 前后端均在 dev；开始时工作区干净，前端已有一个未推送提交，保留。
- 仅本地实现、隔离环境验证；不操作业务库，不 commit/push/deploy。

## 验证与恢复

- 迁移追加新文件，旧迁移不改写；结果见下文。

## 当前实现

- 迁移：src/migrations/1792108800000-AddResourceEnglishFields.ts，五个新列默认空字符串，应用回滚保留列。
- 后端：三个资源 Entity、DTO、Service；前端：resource 类型、请求映射、三类表单/列表及中英文标签。
- 需求与 API 合同已同步；列表/详情及餐厅景点选择详情返回新字段。
- 前后端定向 ESLint、类型检查、迁移命名、前端 resource.service 定向测试已通过。
- 隔离数据库脚本：test/resource-english-fields.integration-check.ts，仅访问 localhost:55439，不加载环境文件；最终已通过，测试夹具使用专用城市。

## 验证通过

- `pnpm exec ts-node -r tsconfig-paths/register test/resource-english-fields.integration-check.ts`：完整60条迁移空库执行、重复执行0条；59条旧链代表性数据升级至新列，原字段保持不变（含餐厅null价格、景点0价格）；真实Service+DTO验证省略/null/空白、新增/修改/清空、列表/详情及资源选择详情。
- 最终 `pnpm exec tsc --noEmit` 和两仓 `git diff --check` 通过；隔离测试创建的数据库由finally删除。

## AOCI 阻塞与继续入口

- 最终稳定业务源码后调用一次 `aoci_maintain`：`status=stopped/result=blocked`，未签发候选（included=0，remaining=86）。logical_plan=f3b9695ddbda8ae0d0294cb0adb7057f177710bb695c2dcc2bebe1f143925b07。
- 返回 `pending_transactions=0/recovery_pending=false/third_party_conflict=false`，本次没有正式索引写入，无未决写事务。
- 当前 Guide（`aoci index agent guide --agent codex --json`）仍为 blocked：无关 `lynxtour-visits`、酒店导入输出、历史验证文档及三个已删除的前端 TODO 存在 missing/orphan/observed_pending。普通维护 Schema 无路径范围能力；object_refs 仅用于已对齐索引的 cognition_optimization，不能隔离签发本次变更。
- 遵守根 AGENTS 收尾边界，未裁剪批次、修改范围、删除历史条目或确认未审阅的观察指纹。独立索引维护任务可从当前 Guide / scope status 继续；本次索引尚未对齐。
- 前端 Vitest 产生的两处无关自动导入声明变化已恢复；临时 PostgreSQL 容器 sunrise-resource-english-test 已停止并自动移除。
- 尚未 commit/push/deploy；迁移未应用到业务环境。

## dev-fast 开发发布（2026-10-15）

- [x] 重新读取规则、工作流、部署脚本并确认开发目标。
- [x] dev-fast 定向前后端 ESLint 和类型检查通过；本阶段不重跑测试/全量验证。
- [~] 隔离前端未发布提交，提交本次前后端字段改动并推送 dev。
- [ ] 通过现行 Actions/原子脚本部署后端并运行兼容迁移，再部署前端。
- [ ] 核对准确发布版本、health、迁移历史并记录结果。

目标：47.114.79.126，/opt/sunrise-travelops-dev，travelops_dev。API/数据库容器环境和 SELECT current_database() 已确认，禁止操作 prod。
当前后端 8c98f2a5e7a082783d0a81479352823367eeddcf，前端 36910b051c5cc590772bb52296c4babd2bd3adc3。
库已有59条迁移，候选只有 AddResourceEnglishFields1792108800000 未执行；只给三个资源表增加带空字符串默认值的五列，不改旧数据，不在 breaking 列表。按当前脚本使用 REVIEWED_MIGRATIONS 精确确认，不添加额外备份或演练。
当前仓库 dev 自动发布开发、main 手动生产；遵守此目标映射，不使用技能旧措辞里的 main。当前部署已取消旧 SSH 上传和镜像归档路径，使用自托管 Actions 在 ECS 构建，避免发明第二套传输布局。
前端本地43414d1（城市标签/归档记录）未推送且与本次无关，用独立发布工作区基于 origin/dev 交付英文字段，保留原工作区。
