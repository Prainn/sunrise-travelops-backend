# 后端接口与持久化开发

按任务只读对应章节：接口变更读 Workflow、API Contract 和 Documentation；持久化、权限、冻结/计算或事务改动再读 Database / Business Invariants。

## Backend Change Workflow

修改 endpoint 检查 Controller → DTO → Service → Entity/Repository 或结构化 SQL → migration（schema 变化时）→ Swagger → frontend caller；检查影响，不机械修改每一层。

调用链明确的接口改动从相关合同与这条链开始；跨端本身不触发完整 AOCI。只有发现共享授权、隔离、冻结/计算、事务或模块边界影响时，才按根任务分级扩大阅读。

修改 DTO、实体、服务调用或持久化 JSON 时，同步检查 contract、调用者、fixture、repository mock、seed、历史记录及 migration。类型断言不能证明运行时结构正确。Swagger 从代码生成，不代替根 API 合同。

## API Contract

详见 [共享 API](../../../docs/api/Sunrise%20TravelOps%20后端说明.md)。

- `/api`；普通成功由 `ResponseInterceptor` 包装 `{ code: "SUCCESS", message: "success", data }`，不在 Service/Controller 再包一层。204 无 body，文件和 health 成功响应有显式例外。
- `ApiExceptionFilter` 输出 `{ code, message, data: null, details, timestamp, path, requestId? }`；业务拒绝用 `BusinessException` 和现有 ErrorCode，保留真实 HTTP 4xx/5xx，不以 200 代替错误。
- 单资源不存在 404，空列表 200；分页 `{ list, total, page, pageSize }`。范围外业务记录和无权限访问的状态码按共享合同及所属业务合同核对，不能统一改写。
- GET/PUT 通常 200，未覆盖的 POST 默认 201；登录/刷新显式 200，退出等显式 204。新增动作核对 Controller 实际状态及前端消费者。
- 全局 ValidationPipe 负责白名单、拒绝多余字段及转换；DTO 嵌套校验不能替代 Service 的资源归属、状态和版本检查。

## Database / Business Invariants

- `synchronize:false`；应用启动不自动 migration。追加迁移，不修改已部署文件；新迁移冻结自己的转换定义，不导入会变动的运行时代码。
- Entity 与迁移保持映射一致，但 `structured-itinerary.ts` / `structured-quotes.ts` 的 SQL 明细表并非都有 Entity；完整 schema 看 migration，不能直接用 ORM 差异删除已有约束。
- 持久化变更检查旧数据及恢复路径，尤其 DROP、rename、type change 和 JSONB 转换；不直接修改生产 schema。日常业务不恢复 data JSONB 双写；冻结存档和审计 JSON 按现有设计保留。
- 金额沿用 numeric 与现有分币舍入工具、HTTP 两位小数字符串；迁移不得截断历史精度或用今天资源价伪造旧参考价。当前仅人民币，无汇率模型。
- `effectivePermissions` 以当前身份决定权限，不叠加其他身份；公共资源访问仍须校验动作权限、状态及引用有效性；询盘、行程、成团和独立站专属配置的访问范围按对应需求及合同校验，不能以公共资源共享替代业务归属检查。
- 每行程一份 V1 冻结报价，quoted 不可普通编辑，修改复制独立 Draft。冻结价格/数量/客户及计算结果不追随主数据更新；读取历史报价不得重新计算。
- 稳定明细 ID、父版本、业务保存、调价历史和日志保持事务一致；试算/取消/失败不记成功历史。内部成本、利润和调价原因不进入客户 PDF/Word。

## Documentation

- 新增、更新或移除 HTTP 接口时，必须在同一任务内同步更新根 `docs/api/Sunrise TravelOps 后端说明.md` 的对应主题章节；接口与文档未同步，不得视为完成。API 合同集中维护在这一份文档中，未经用户明确要求，不新增按模块或服务拆分的 API 合同文件。
- 同步内容按实际影响覆盖方法、完整路径及服务地址、认证与权限/数据范围、路径/查询/请求体字段及约束、响应结构、HTTP 状态与错误码，以及分页、版本、幂等和文件响应等约定。仅更新 Swagger、DTO、README 或部署记录不能替代 API 合同。
- 收尾按受影响模块实际注册的路由逐项核对文档，包含新增及保留的接口，避免只记录本次新增动作而漏掉已有列表/详情等配套接口；公开接口、非 `/api` 前缀和未纳入 Swagger 的接口同样必须记录。移除接口须同步清理当前合同及失效引用，不保留为仍可用接口。

其他文档按[根导航](../../../AGENTS.md)同步；涉及身份、结构化存储、冻结/调价约束时核对 [P0 的组织、调价与数据完整性章节](../../../docs/requirements/Sunrise%20TravelOps%20P0需求说明.md#organization)。环境发布结果留在部署/验证记录，不把动态在线 SHA、迁移执行状态或命令清单写入本文件。
