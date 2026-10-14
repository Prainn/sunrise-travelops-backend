# 旅游资源库统一重构 TODO

来源：docs/plans/旅游资源库统一重构-一次性执行Prompt.md。以下初始实施记录保留当时状态；2026-10-12 已按后续授权完成本地测试、浏览器打印与索引维护，结果见后文。未提交/推送/部署。

初始状态：后端 48 个、前端 47 个 src 文件匹配 library/resourceLibrary；前端已有无关改动 `.eslintrc-auto-import.json`、`types/auto-imports.d.ts`（不动）。后端工作区干净。

- [x] 1. 根 docs 归并最终口径（P0、P0.1、独立站需求、成团与导游、后端 API、独立站 API、architecture）
- [x] 2. 后端迁移：引用重绑/解除 → 删 shared 库资源及子记录 → 删 library 列/索引/外键/resource_libraries → 重建唯一约束 → WebsiteConfig.hotels 空集合
- [x] 3. 后端公共资源：resource-scope/validation/entity/dto、身份映射、用户 resourceLibrary
- [x] 4. 后端组团社业务部+计调绑定、询盘选用规则、父子社去同库条件
- [x] 5. 后端独立站配置酒店（价格 0 合法）与行程 configHotelId
- [x] 6. 后端成团航班/导游/请假去 library，跨业务占用统一
- [x] 7. 前端类型/service/store/选择器/资源页，删 ResourceLibraryTag 等
- [x] 8. 前端独立站“酒店”页签与 WebsiteDayHotels 选择/参考价
- [x] 9. 必要单元测试代码（不执行）

关键决定：保留 shengxu 库资源原 UUID/编号；必需关联（航班、评分导游）无映射时迁移报告并终止事务；公共酒店散客价仍必填。

状态：代码、文档、单元测试代码均已编写；按 Prompt 未运行任何检查/测试/迁移，未提交。待定：迁移遇被引用的共享航班/导游/组团社会中止并输出清单。

## 跟进：文档核对（未运行任何验证）
- [x] 成团与导游管理、P0、P0.1、API、架构、独立站文档中残留的按库隔离表述已清除
- [x] 实体索引名与 migration 一致；tours.library 已在 migration 中删除
- [x] 5 个 test 脚本已改为统一资源模型（只改代码，未运行）

## 2026-10-12 测试与验证（本对话授权执行）
- [x] 静态检查：前后端类型、受影响 lint、权限绑定、必要构建；修复本次缺陷
- [x] 单元与集成检查：先核对测试环境安全，仅本地隔离数据库
- [x] 新迁移空库/重复运行/代表性旧数据升级与失败回滚
- [x] 汇总验证证据和剩余问题
- [x] AOCI 收尾：后续获得索引维护授权，已完成 Scope、孤儿与完整批次处理，详见最终结果

验证进展：
- 初轮后端 tsc 报旧参数/缺 hotels 和 configHotelId；前端 FlightRecord 泛型约束报错；受影响 lint 95 后端错误及 13 前端错误。已修复本次编译、导入、格式问题。
- 后端 90 单元、20 HTTP e2e、前端 build、权限绑定（169 endpoints/22 routes/14 cases）通过。HTTP 与 Docker 需要本机沙箱外权限，自动审批允许。
- 专用容器 sunrise-unify-validation-20261012，127.0.0.1:55439，PostgreSQL 16；未连接业务库，验证结束后已移除。
- 原四套集成脚本的迁移前夹具必须保留当时必填的 library；统一迁移须在层级/成团/独立站迁移之后执行。已修正顺序和夹具，不改变历史迁移。
- 发现未发布统一迁移错误查询已删除的 itineraries.data，已改结构化 itinerary_hotels/vehicles/guides/items 引用阻断。
- 发现配置酒店仅预览检查、保存接口放行无效 ID；真实 HTTP 回归已复现 201 而非 400，已在 preparePlan 补齐同版本/城市及新选启用校验。
- 成团 19 项、组团社及其他新增回归全部通过，详细结果如下。


### 最终验证结果（2026-10-12，本地工作区）

| 检查 | 命令 / 结果 |
| --- | --- |
| 后端发布门禁 | `pnpm verify:release`：54 个迁移命名检查、全量 lint、Nest build 全通过 |
| 后端完整类型 | `pnpm exec tsc --noEmit`：通过，含 integration-check |
| 后端单元 | `pnpm exec jest --runInBand`：9 suites / 90 tests 通过 |
| HTTP e2e | `pnpm test:e2e --runInBand`：4 suites / 20 tests 通过 |
| 前端 | 受影响 src 文件 ESLint、`pnpm build`（含 vue-tsc）、`pnpm test`（7 files / 39 tests）均通过 |
| 权限绑定 | 根 `node scripts/check-role-permissions.cjs`：169 endpoints、22 protected routes、14 role/scope cases、3 resource create actions 通过 |
| 数据库集成 | `pnpm exec ts-node test/agency-hierarchy.integration-check.ts`、`structure.integration-check.ts`、`tour-management.integration-check.ts`、`website.integration-check.ts`、`resource-unification.integration-check.ts` 五套均通过；成团套件 19 checks |
| Diff | 两仓 `git diff --check` 通过 |

新增迁移专项覆盖 53→54 升级、完整空库链及重复运行（原集成套件）、9 类资源保留/删除、联系人和价格子记录删除、普通行程/询盘/请假引用阻断、失败事务回滚（含先前 JSON/schema 写入）、独立站解除公共引用且保留自有文案、冻结快照不变、结构化读取与全局唯一约束。预期失败分支会打印 migration failed，但断言验证其回滚成功后套件最终 PASS。

新增独立站 HTTP 回归覆盖不存在/停用/异城配置酒店不能新选，以及零价配置酒店关联的保存、读取、复制、配置版本和车型报价保持；输出不带配置/公共资源 ID。原套件继续覆盖权限隔离、人工酒店、冻结快照与版本冲突。

本次修复涉及：前端资源 CRUD 泛型和未使用 watch；后端迁移引用查询、酒店保存校验、失效参数和导入；上述测试脚本夹具/顺序/断言；既有受影响文件 lint 格式。共享 API 与 P0 中父子组团社/公共库唯一性残留条款已校正。前端 build 正常重新生成自动导入/组件声明，组件声明删除已移除组件并包含 WebsiteConfigHotels。

测试环境：本任务创建的 `sunrise-unify-validation-20261012` 已删除（含临时测试数据库）；原本机业务 PostgreSQL 容器未执行测试或迁移。没有 commit、push、deploy，未连接开发/生产业务库。浏览器交互/打印验收随后完成，证据见下文；真实开发库迁移阻断记录未检查。

### 前一阶段遗留事项（后续处理见下方）

- AOCI rc12 `aoci_maintain` 返回 stopped/blocked、included=0、total_targets=123、missing=5、stale=118、orphan=4、observed_pending=1。包含此前重构的全量漂移，以及与本次验证无关的 `TODO-role-permission-alignment-2026-10-12.md`。普通维护 Schema 没有路径范围过滤，未拆裁完整批次、未扩为全仓索引修复。
- 工具事实 `pending_transactions=0`、`recovery_pending=false`、`third_party_conflict=false`；没有提交任何 Entry/Scope acknowledgement/Apply。Guide 同样为 blocked，stop.rule_code=observed_pending，涉及 `.aoci/baseline.json` 的 observe。无未决写事务，不通过重复维护清状态。
- 索引独立维护入口：`/Users/joe/.local/share/aoci/0.1.0-rc12/aoci index agent guide --agent codex --json`；需先按 Guide 审阅已变化的 website-engine.spec.ts Observe 证据，再处理孤儿与完整签发批次。本次维护 logical_plan=`e08c15cb57939d2fc1f1c44e94db4c922e88ff583e4ba620721794c2b1c05ece`（下次须重新核对真实状态）。
- 后端 `AGENTS.md:37,47` 仍有“跨库拒绝”“资源按 library / ROOT 不能跨库”的旧工程说明，与本次已批准的统一公共资源需求/API 冲突。本次按当前业务合同测试，未把这两条当作恢复分库的依据；应在规范维护时同步移除旧描述。

## 后续：浏览器、打印与索引收尾
- [x] 隔离环境下公共资源/父子组团社/独立站酒店/行程浏览器交互与中英文打印
- [x] 修复验收发现的问题并定向复验，同步旧规范条款
- [x] AOCI Observe、孤儿、完整候选批次维护及 Verify/Check/Guide
- [x] 清理本次测试环境、保存验收证据；不提交、不部署


### 浏览器与打印验收证据（2026-10-12）
- 仅本机 4300 前端 → 4301 临时 Nest API → 55439 隔离 PostgreSQL；合成测试账号与数据，未连接业务库。
- 公共酒店列表/新增成功，未出现资源库字段；独立站配置酒店零价读取和参考价 123.45 编辑保存成功；草稿显式切换配置 v4→v5 后，同城仅启用酒店可选，双语名称和公共关联带入、内部参考价显示、草稿保存成功。
- 盛旭计调子组团社可选择霖熹父组团社并创建成功，父节点显示二级 1；父归属未被强制继承。
- 已确认行程表单锁定，配置更新后仍使用冻结版本；Chrome 真实点击打印，分别另存英文/中文 PDF。每份 1 页 A4，视觉核对表格、字体与各段落；文本校验 RMB 1288.50 PP，未含内部参考价、资源 ID、利润或浏览器地址。此样例不覆盖超长多页行程。
- 发现打印表格最右边框受页面裁切：print.ts 打印 body 留 1px 内边距，重新导出中英文 PDF 后边框完整。`pnpm exec eslint src/views/website-inquiries/itineraries/print.ts`、`pnpm type-check` 通过。
- PDF 与截图保存在本对话 artifact 目录 `/Users/joe/.codex/visualizations/2026/10/12/01a12ec3-8c72-7de2-ba6e-7c1bcd981784/uat/`：quotation-en-verified.pdf、quotation-zh-verified.pdf、verified-en.png、verified-zh.png、hotel-reference.png、chrome-print-verified.png。
- 内置浏览器 Blob iframe 空白且打印等待，Chrome 同路径正常；内置浏览器结果不能作为应用打印失败证据。首份英文样本误保留浏览器页眉，已由 verified 版本取代。
- 旧工程规范：根 AGENTS 的资源库隔离检查改为公共资源权限与独立站配置边界；后端 AGENTS 两处旧跨库描述、前端技能页面参考旧资源库语义同步修正。
- AOCI 已独立审阅 website-engine.spec.ts 与当前引擎，Scope acknowledge 事务 74f57bede0b026b0188fb4bd 已 applied；4 个工具明确返回的孤儿 Entry 已移除，完整候选创作已完成。
- 临时 API 收到 SIGTERM 后恢复原集成脚本后半段，因为浏览器已更新配置而遇到预期的旧版本 409；这不是重新运行原套件的通过记录，finally 已关闭 API 并清理临时库。临时启动文件已删除，Vite 已停止。专用容器 sunrise-browser-uat-20261012 已删除。

### 最终索引与规范结果
- 全部签发候选已按完整批次 applied；Code 覆盖 661/661，missing/stale/orphan/unbaselined 与 Observe 待审均为零。`aoci verify --json`、`aoci check --json`、`aoci index agent guide --agent codex --json` 通过，Guide complete=true、next_action=none；无未决事务、Recovery 或第三方冲突。维护模式只同步索引，不宣称全量 Overview 认知或线上数据库状态。
- 现行需求、API 与架构中的分库残留已归并；独立站酒店配置、零价及 configHotelId 条款已补入对应主题。
- 删除 LeaveQueryDto 已废弃 businessUnit 参数；前端请假消费者未发送该参数。受影响 ESLint、完整 tsc 通过；真实 ValidationPipe 正常查询接受、旧参数返回 400。
- 标准价唯一冲突提示移除旧分库措辞，中英文同步；JSON 解析与全量双语键一致性检查通过。
