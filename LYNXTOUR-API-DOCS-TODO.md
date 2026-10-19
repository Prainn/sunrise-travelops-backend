# 只读表格迁移与 API 合同归并

授权范围：仅本地迁移、文档归并和必要验证；不提交、不推送、不部署，不连接或修改业务数据库。

- [x] 将根 `lynxtour-visits/` 服务、页面与运维脚本迁入 `ops/lynxtour-visits/`，保留独立运行、认证、只读账号和部署边界；11 个文件逐字节比对一致。历史 TODO 归档到 `docs/deployment/2026-10-16-lynxtour-visits-history.md`。
- [x] 将三份分散 API 文档合入根 `docs/api/Sunrise TravelOps 后端说明.md` 第 18–20 节，补齐 `GET /api/visits`；独立站端点表列出 21 个完整路径、权限和下载点击状态例外。删除旧合同文件，更新根/两仓 AGENTS、需求、架构、验证、计划和部署引用。
- [x] 验证迁移后的语法、静态资源与部署打包路径、统一合同路由覆盖和文档链接；结果见下。
- [x] 代码迁移和文档归并已完成；前序 AOCI 维护遇到混合漂移后，用户已授权完整对齐。当前维护进度和最终验收统一记录在根 `.aoci/drafts/20261019-full-alignment-todo.md`，下文保留前序阻塞证据。

已核实：后端 dev 分支已有本会话对 AGENTS.md 的未提交修改，继续保留；根只读表格目录有 11 个服务/页面/部署文件和 1 份历史 TODO。部署脚本通过 `__file__` 定位同目录源文件，服务器 `/opt/lynxtour-visits-dev` 路径保持原值。NestJS 165 个接口与只读表格 2 个数据接口为本次覆盖基准。

历史 TODO 中“不测试、直接部署”仅是旧任务记录，不适用于本次任务。历史记录归档到根 docs/deployment；本文件是当前恢复入口。

## 验证结果

- `node --check ops/lynxtour-visits/server.cjs` 和 `node --check ops/lynxtour-visits/app.js` 通过；4 个 Python 脚本均经 `ast.parse` 验证通过，无脚本被执行。
- 本地读取 deploy.py/update.py 的打包清单，分别构建并校验 9 文件/4 文件内存 tar 包；源目录由 `__file__` 定位，各上传文件内容与迁移后的文件一致。页面引用的 app.js/style.css 存在，原根目录已移除。
- 当前源码与统一合同按方法/路径比对通过：NestJS 165/165 + 独立 viewer 2/2 = 167/167。通用资源路由及正文简写按文档声明展开，不包含 Swagger 或静态资源。
- 10 份受影响文档的 113 个本地 Markdown 链接（含锚点）全部通过；全工作区含隐藏文件搜索未发现指向已删除 API 合同的引用。历史部署记录中的旧命令保留，并已注明仅为历史路径。
- 后端与前端 `git diff --check` 通过；前端本次仅更新 AGENTS.md 引用，已有语言文件、操作日志页面和类型声明改动保持原样。
- 未运行应用全量构建或数据库集成测试：本次未修改应用代码内容；检查未访问网络、业务数据库或服务器。未提交、推送或部署。

## 修改范围

后端：AGENTS.md、ops/lynxtour-visits/（11 文件）、本恢复记录。前端：AGENTS.md。根文档：AGENTS.md、统一 API 合同及三个旧合同删除、architecture/overview.md、独立站需求和历史验证的合同引用、资源重构计划中的失效路径、Lynxtour 部署说明及历史 TODO 归档。

## 前序 AOCI 维护历史

本轮 `aoci_maintain`（0.1.0-rc12）返回 `stopped/blocked`、`candidates=[]`、included=0、total_targets=43、remaining=43；15 个 orphan_remove_candidates 对应本次已归并的三个旧合同及原根表格目录的十二个旧路径。候选混入既有 Dashboard、语言文件等漂移，另有2项 observed_pending_review；普通 Maintain 无任务路径范围参数，未裁剪批次或单独移除旧 Entry，未扩大为全仓修复。

logical_plan=`22b0f47f8c2e75ef79436d26f2db288fdeb32da71af4db26266030c52444a776`，batch_identity=`21581a4ad16f572b53821f23b2a806509389471e2cbfbc904abec247bd65dbf4`。工具确认 pending_transactions=0、recovery_pending=false、third_party_conflict=false、network_accessed=false；无本次待决正式索引写事务。

继续入口：独立维护任务运行工具提示的 `'/Users/joe/.local/share/aoci/0.1.0-rc12/aoci' scope status --json`，按实时 Guide 处理 observed 审查及所有关联漂移，重新签发完整批次；保留上述迁移映射及旧路径删除事实，不能用补回旧文件或直接修改索引绕过状态。
