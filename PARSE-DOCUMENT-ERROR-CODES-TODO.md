# 询盘文档解析错误码

范围：六类解析/大小失败使用稳定错误码；保留 HTTP 状态及中文 message；不改前端，不 commit/push/deploy，不访问业务库。

- [x] 核对 parseInquiryDocument、FileInterceptor、BusinessException、ApiExceptionFilter 和前端调用。上传超限在 Multer 阶段先返回 413，需接口专用转换。
- [x] 同步 API 合同，新增错误码并切换解析异常；接口专用上传过滤器复用 ApiExceptionFilter。
- [x] 补解析 spec 与真实 multipart Controller/过滤器测试，验证六类错误及成功路径。
- [x] 定向 lint、类型和测试验证。
- [!] AOCI 稳定态收尾已尝试；混合历史漂移阻塞，未签发可独立写入的候选，索引尚未对齐。

保留工作区此前所有未提交修改。权限声明、全局状态码映射和前端均不调整。

## 实现及验证

- `src/common/constants/error-code.ts`：新增六个 INQUIRY_DOCUMENT_* 常量。
- `src/inquiries/parse-inquiry-document.ts`：使用 BusinessException，保留各中文 message 和 400/413 状态。
- `src/inquiries/inquiry-document-upload.filter.ts` + `inquiries.controller.ts`：只在 parse-document 接口将 Multer 的 PayloadTooLargeException 转为文档业务异常，委托 ApiExceptionFilter 生成统一响应；全局过滤器本身无需修改。
- 根 `docs/api/Sunrise TravelOps 后端说明.md`：更新约 490 行的文档导入合同，列明六码、状态和原 message。
- `parse-inquiry-document.spec.ts` 与 `test/fixtures/inquiry-document.ts`：真实 PDF/doc/docx 成功、扫描件、损坏 PDF、模拟加密提取失败、非法/缺文件、Word 空文本、合并正文/文本框文本长度边界、buffer 大小边界。
- `test/inquiry-document.e2e-spec.ts`：使用真实 Controller、FileInterceptor 和 ApiExceptionFilter，无数据库；验证五类 400、缺文件、上传前置 413（解析函数未被调用）、成功 envelope，以及 path/requestId/timestamp 保留。
- `pnpm exec jest --runInBand src/inquiries/parse-inquiry-document.spec.ts`：13/13 通过。
- `pnpm exec jest --config test/jest-e2e.json --runInBand test/inquiry-document.e2e-spec.ts test/api-contract.e2e-spec.ts`：16/16 通过。
- `pnpm exec tsc --noEmit --incremental false`、受影响七个 TS 文件定向 ESLint、`git diff --check`：通过。测试应用已关闭，无任务测试进程遗留。

## AOCI 继续入口

最终源码稳定后调用一次 aoci_maintain，status=stopped/result=blocked/aligned=false。混合 code missing=29、stale=80，包含本任务之外的历史前端与输出文件；total_targets=109/included=0/candidates=[]。pending_transactions=0/recovery_pending=false/third_party_conflict=false，无未决正式写事务。普通维护无单文件范围参数，object_refs 仅支持已对齐的 cognition_optimization；本任务不裁剪候选或扩修无关历史。

独立索引维护任务按实时 Guide 解决混合漂移后继续，logical_plan=55dd084cab6189154e23b2a0df72ccdace3dbd381dd4268556db3256d7b44342，batch_identity=21ce6c5eb57431fad022066859e5e15d9c33380d9deba1c6f0f7a74a6b32e7e8。业务实现和验证已完成，索引对齐待续。
