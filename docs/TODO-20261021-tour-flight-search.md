# 成团航班远程分页搜索

授权：用户要求后端提供成团航班搜索接口并提供前端接入prompt，不用验证。仅本地实现，不提交/推送/发布、不操作业务库，不执行测试/lint/类型检查/构建/浏览器或接口验证。

- [x] 阅读既有航班查询、成团弹窗、共享远程选择器和合同。
- [x] 将既有GET /api/tours/flights统一改为分页返回，默认20、上限100，保留关键词匹配和权限/业务范围/航班可选条件。
- [x] 同步需求/API/Swagger；交付前端接入prompt，前端源码未修改。
- [!] AOCI收尾因无关历史漂移阻塞，未对齐。

改动：src/tours/tour.dto.ts、tours.controller.ts、tours.service.ts；根docs/requirements/成团与导游管理.md和docs/api/Sunrise TravelOps 后端说明.md；outputs/2026-10-21-成团航班远程搜索-前端Prompt.txt。

接口复用原因：已有keyword筛选，缺少分页上限，无需新增重复路由或数组兼容。DTO继承已有PaginationQueryDto，Service共享同一筛选片段完成count和LIMIT/OFFSET查询，返回{list,total,page,pageSize}。无schema或权限变化，不更改历史航班快照及保存规则。

交付边界：前端现有tourService.flights仍按数组消费，本次按用户要求仅提供接入prompt；必须完成前端分页接入后配套发布。后端接口目前仅本地修改，不能宣称已在线。所有验证均按用户要求未运行。

AOCI维护返回stopped/blocked，139目标、included=0，混入无关漂移和vercel.json孤儿。logical_plan=3dbfb937851017c69cd9e428d4495c3a4c66a2ff9e2888d6b0e4fc8b9e452f2e；batch_identity=cb4f247613c99a61c97d9ec2d9677fd0722ed1f97c4f6274b4020499fb5f2d04。pending_transactions=0、recovery_pending=false、third_party_conflict=false，无正式索引写入。普通维护不支持按本任务路径限定，不裁剪批次、不处理无关条目；独立维护从最新Guide重新计划。本次未运行Verify/Check。
