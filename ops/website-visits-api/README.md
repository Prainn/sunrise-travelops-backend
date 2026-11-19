# 独立站访问记录的只读来源

2026-11-18，旧机生产库成为唯一登记来源。新机 dev 通过私网 HTTPS 查询原始访问记录，各环境分别存放确认与询盘关联。交接时核对了 558 条记录的 UUID 和全部 17 个字段。[交接记录](../../../docs/deployment/2026-11-18-visits-source-handover.md) · [API 合同](../../../docs/api/Sunrise%20TravelOps%20后端说明.md#lynxtour-viewer-api)

## 运行配置

- 旧机生产 API 使用专用只读账号查询 `public.lynx_visits`，机器 GET 接口验证调用令牌和来源地址。登记入口写入生产，旧版 Resolver 使用另一只读服务。主业务连接由原 `DATABASE_*` 配置提供。
- 新机 dev 使用独立调用令牌，通过私网 relay 校验生产域名的 TLS 证书。上游故障时查询返回错误。运行端路径和域名路由见交接记录。
- 本目录两个 Compose 文件与 `source-location.inc` 是恢复时可参考的配置模板。应用前须核对现行网络、服务名及实际来源地址。令牌保存在宿主受保护文件中。用 `docker compose config --quiet` 校验配置。
- 两环境继续以各自身份、权限及业务库处理访问确认、询盘和归因关联。生产产生新访问后，如需反向交接，先核对新增 UUID 和 reference，再确定停写与增量复制窗口。

## 数据复制工具

后端目录运行 `pnpm exec ts-node scripts/copy-visit-source.ts`，**默认dry-run**。必须显式提供 `VISITS_COPY_SOURCE_URL` 和 `VISITS_COPY_TARGET_URL`；工具不加载应用.env，不运行迁移、建角色或改变配置。

只有获批应用时才添加 `--apply`，并设置 `VISITS_COPY_CONFIRM_TARGET` 为实际目标数据库名。源连接应SELECT-only；目标连接仅授本次需要的读取和插入权限。不要把URL明文放进命令历史或报告。

工具使用来源repeatable-read快照及目标事务，校验17列schema一致、库身份不同、UUID/ref冲突。默认只报告数量与缺失UUID；执行只插入缺失原始行，原UUID/时间微秒/指纹/null全保留，精确回读校验；不更新/删除任何已有记录，不复制确认、询盘、来源关联或迁移历史。目标存在来源没有的新记录时保留。任一冲突整批拒绝，输出冲突UUID，不输出归因正文。最后增量必须在写入口转向生产、旧请求排空后重新执行和核对；一次dry-run不代表持续写入已收口。

## 本地隔离复现

创建仅绑定127.0.0.1:55457的临时PostgreSQL 16容器，密码 `isolation-ci-only`，不要使用本地业务PostgreSQL。执行 `pnpm exec ts-node test/website-visits-api.integration-check.ts`；测试自己创建随机两库、只读角色及临时TLS证书，结束删除。可通过 `ISOLATION_PG_PORT` / `ISOLATION_PG_PASSWORD` 指向另一个**专用本地隔离**实例，不支持远端业务库。

测试覆盖UUID/17字段精确复制、schema与数据冲突拒绝、两环境确认及询盘独立、真实JWT/HTTPS/数据库、机器密钥和IP限制、上游异常无副本回退、CSV及表单/JSON登记兼容。测试名称production/development只是本地随机测试库角色。
