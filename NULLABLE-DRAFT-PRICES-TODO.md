# Draft 实际价格可空

范围：酒店 unitCost、导游 dailyPrice、日资源 unitCost；不修改前端，不 commit/push/deploy，不操作业务库。

- [x] 核对合同、DTO、normalize、计算、SQL、冻结及日志链路。现有 PDF 门禁为 PDF_NOT_READY；moneyResponse/diffChanges 已保留 null。
- [x] 同步合同和需求，修改后端可空保存、调价及试算，追加 migration `1792195200000-AllowNullDraftActualPrices.ts`。
- [x] 补 spec，验证空价保存/恢复、HTTP 试算、冻结拒绝、补价恢复。
- [x] 在本任务创建的隔离 PostgreSQL 验证完整迁移链、重复执行、代表性旧数据升级及约束；运行定向 lint/type/spec。
- [!] AOCI 已尝试收尾，因混合历史漂移未对齐；见下文。业务实现及验证已完成。

实现选择：试算新增 pricingComplete/missingPrices（仅三类实际价）；缺价明细金额及日资源 totalCost 保留 null，汇总跳过缺价。空价免原因、清空不写金额调价记录（由普通差异日志记录）；从 null 补价视为首次定价，按参考价规则校验。

注意：起始工作区已有 itinerary-validation.ts/.spec.ts 的景点空描述修改及资源选择器等其他修改，保留不覆盖。

## 最终验证

- `pnpm exec jest --runInBand src/inquiries/nullable-draft-prices.spec.ts src/inquiries/inquiry.dto.spec.ts src/inquiries/quote-pricing.spec.ts src/inquiries/itinerary-validation.spec.ts`：4 suites / 41 tests 通过。
- `pnpm exec tsc --noEmit --incremental false`：通过。
- 受影响 TS 文件定向 ESLint：通过；`pnpm check:migrations`：61 条迁移命名通过；`git diff --check`：通过。
- `pnpm exec ts-node test/nullable-draft-prices.integration-check.ts`：通过。隔离 PG16 验证空库 61 条完整链、再次执行无变更、上一版结构带价数据升级无损、冻结快照不变、新选资源初始空价保存、清空保存/读取/复制、HTTP POST 空价试算、GET pdf-data / POST confirm-pdf 缺价 400/PDF_NOT_READY、补价后正常冻结及 quote_resource_lines 金额、非负约束仍有效、存在 null 时回退拒绝且不造零。测试使用固定 localhost:55446，不加载业务库配置。
- 测试应用与连接已关闭，临时数据库已删除，任务容器 `sunrise-nullable-prices-test` 已删除。未对业务库运行迁移。
- `structured-quotes.ts` 已核对：只在现有 service 完整性门禁通过后写冻结明细，当前可空 quote_resource_lines 无需放宽；集成测试覆盖正式冻结写入。`changes.ts` 已核对：保留 null、区分 0，格式化及差异日志 spec 通过，无需修改。

## 修改文件

根 docs：API 合同的行程明细/计算/调价/自定义餐食段；P0 Draft 规则；P0.1 调价规则。
后端：inquiry.dto.ts、itinerary.types.ts、itinerary-validation.ts、price-adjustments.ts、quote-pricing.ts、structured-itinerary.ts、新迁移及 nullable-draft-prices.spec.ts；test/fixtures/nullable-draft-prices.ts、test/nullable-draft-prices.integration-check.ts。现有 test/structure.integration-check.ts 仅补 nullable 类型收窄，未执行该旧全域测试。

## AOCI 待续

最终稳定状态调用一次 aoci_maintain：status=stopped/result=blocked，aligned=false；混合历史 missing 26 / stale 77，包含无关前端及酒店英文名输出等。authoring_batch.total_targets=103，included=0，candidates=[]，pending_transactions=0，recovery_pending=false，third_party_conflict=false；未签发可写候选，无未决正式写事务。普通维护 Schema 只有卷级 scope，object_refs 仅适用于已对齐的 cognition_optimization，无法独立签发本任务批次，不裁剪或扩修历史。

恢复入口：独立索引维护任务按实时 Guide 解决混合漂移后再维护本次受影响条目；logical_plan=73bdf2e16ef40bbf86fdb84ee6bb556cf3dd60673164298cacd530c038bd1680，batch_identity=08c3dc99ec1945a64829f972a37c25d5eacd8f666b7522d038c6f26fe23acd79。业务结果已完成，索引尚未对齐。
