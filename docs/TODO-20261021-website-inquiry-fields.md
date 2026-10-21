# 独立站询盘字段调整

- [x] 核对引用任务、当前合同及调用链；用户确认霖熹/独立站一起改，旧编号保留，新询盘采用 KMLX-WIQ 格式。
- [x] 更新根需求/API 合同，实现后端 DTO、类型、读写及追加迁移。
- [x] 完成必要的定向检查、隔离数据库旧数据升级及接口测试。
- [!] AOCI 收尾受历史漂移及观察证据待复核阻塞，未签发候选；无未决写事务。
- [x] 整理前端 prompt 和验证结果。

范围：本地后端实现、共享合同、必要测试和前端交接；不修改前端，不提交/推送/部署，不操作开发或生产业务库。

依据：引用聊天 01a157eb-9521-76d1-b5ec-a8f116067063 中 01a15819-710a-7982-8dc7-01ca47989241 的确认：联系方式自由文本，旧值仅取电话；收到日期、北京时间、联系渠道、WhatsApp 来源编号、网站询盘编号、首次进入页面、获客来源全可选且手填；更新时间复用 updatedAt；删除询盘抵达/离开时间。行程自身仍有交通时间，生成和预览依赖它们，不在本次删除范围。

当前状态：后端 dev，起点 ea5fc1c，本地领先 origin/dev 1 提交，工作区原本干净。真实链路 src/website/website.controller.ts → website.dto.ts → website.service.ts，结构化 SQL，无询盘 Entity。前端交接需覆盖 src/types/website.ts、src/services/website.service.ts、src/views/website-inquiries/options.ts、components/WebsiteInquiryEditor.vue；新建行程不能再从询盘读取交通时间。

实现：根 requirements/独立站行程与报价V1.md 与 API §18.3 已同步；修改 website DTO/type/service/engine 和相关现有 fixture；新增 migration 1792886400000-UpdateWebsiteInquiryFields.ts、test/website-inquiry-fields.integration-check.ts。询盘交通时间一致性比较已从预览引擎移除，行程自身时间与警告规则保留。

编号：复用 tourNumberBase/pickTourNumber；创建日期取事务 now() 的 Asia/Shanghai 日期。相同账号标识每日共享流水，两业务共用；website_inquiry_numbers 在业务删除后保留分配记录，事务内按日 advisory lock 避免并发和数字后缀标识碰撞。无 tour_code 返回400 VALIDATION_ERROR。旧编号固定。

迁移：破坏性且不可直接 down，phone 原样改名/扩长至 contact_info；删除 email/arrival_time/departure_time，新增7个登记字段及编号登记表。空电话不回退邮箱，旧code/updated_at与冻结快照保留。未来发布需要匹配前端、停写和迁移前备份；应用回滚不能单独恢复旧结构。未对业务环境执行。

验证最终结果：
- pnpm exec tsc --noEmit：通过。
- pnpm exec eslint（全部本次修改的9个TS文件）：通过。
- pnpm check:migrations：通过，68条迁移。
- pnpm exec jest --runInBand src/website/website-engine.spec.ts：5项通过。
- pnpm exec ts-node test/website-inquiry-fields.integration-check.ts：44次HTTP检查通过；空库完整链、重复0、代表性旧结构升级、电话迁移/丢弃邮箱、冻结快照与行程交通时间保留、CRUD字段/清空、参数拒绝、版本、跨业务/负责人范围、只读身份、并发编号、数字标识碰撞和删除不复用均通过。
- git diff --check：通过。前端工作区仍干净，未运行前端检查。
- 初次类型检查发现引擎仍比较询盘交通时间，已按新需求移除并复测；集成测试初次缺少MYS测试字典及新账号缺标识错误码不匹配，补齐测试数据并改为合同约定错误码后通过。
- 一次性容器 sunrise-website-fields-test-20261021（127.0.0.1:55451，PostgreSQL16）及临时库、HTTP服务均清理；未访问5432现有本机数据库或任何远程业务库。

AOCI：已读取当前运行合同并在源码稳定后调用一次 maintain。status=stopped/result=blocked/aligned=false，logical_plan=3898414af073254a7a49094f01d47f7d2753de52eb6e438715bc1cfd1a2f0554，batch_identity=eaf0f0868ade1603b3fb54deb937829d4340efcace58340b321bf316164a71bd；total_targets=53、included=0、candidates=[]，混入历史台账/成团/前端漂移。pending_transactions=0、recovery_pending=false、third_party_conflict=false，未提交正式条目。scope status 确认 observed_evidence_review_required，5个观察文件中有4个不属于本任务；普通 maintain 无按任务路径独立签发能力（object_refs仅适用于已对齐的cognition_optimization），不批量确认无关证据、不扩为全仓维护。CLI guide --help 不支持该命令，未进行写入。独立维护任务从 scope status / 当前运行Guide继续，正式索引尚未对齐。

交接：前端按当前 API §18.3 同步类型、列表/详情/编辑、新建默认值和保存白名单，尤其 options.ts 的新建行程初始化不能再从询盘读取交通时间。展示 updatedAt 为最后更新时间；7个新增字段全可选，联系方式不校验格式，两个编号明确区分，不新增来源登记自动关联。保留权限/只读/版本规则，使用双语i18n；仅必要定向检查/测试，不做浏览器或前端验收。本轮不提交、推送或部署。
