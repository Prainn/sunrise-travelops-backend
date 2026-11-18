# 访问记录只读来源配置候选

2026-11-17仅本地开发与隔离验证；这些文件未被现有Compose或Nginx自动引用，也未上传服务器。生产发布、数据库复制、角色创建和入口代理均须另行确认。唯一合同为根API §19–20，顺序以根 `docs/deployment/2026-11-16-visits-production-api-migration-plan.md` 为准。

## 配置边界

- `compose.source.yml`：最终切换阶段在旧机生产应用启用本地SELECT-only来源和机器GET接口；不能在初始数据复制、写入路由收口及最终增量核对前启用。只改LYNX来源变量，不改业务DATABASE_*。
- `compose.client.yml`：新dev使用HTTPS读取旧机私网地址，Host/SNI仍为api.sunrisevacation.cn，证书必须有效。清空旧DB读取凭据。须确认旧机API已可用、历史登记/Resolver入口已代理到唯一来源，再启用；本应用http模式的登记/Resolver会503。
- `source-location.inc`：仅加入生产HTTPS server，与其现有 `$api_upstream` 配套。其他HTTP/8089入口显式拒绝 `/api/internal/website-visits` 及其子路径，避免通过通用 `/api/` location绕过HTTPS。后端端口只允许受控Nginx，`TRUST_PROXY=1`；Nginx覆盖X-Forwarded-For，绝不透传客户端伪造链。切换时核验实际来源IP是否为172.29.23.198，并与应用白名单一致。GET以外无接口；HEAD由应用拒绝。
- 生成至少32字节随机专用令牌，服务端/客户端各存受保护环境文件；不要复用JWT、Resolver或WhatsApp密钥，不放前端、不写日志。配置通过`docker compose config --quiet`校验，避免打印展开后的密钥。
- 旧机生产PostgreSQL单独创建 `lynxtour_viewer`，仅CONNECT目标库、USAGE public、SELECT public.lynx_visits；无SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS、无业务表读写；默认只读、5秒statement_timeout、连接数限制。核验同集群现存角色再执行，不能给旧dev角色扩权。此步骤本轮未执行。

## 数据复制工具

后端目录运行 `pnpm exec ts-node scripts/copy-visit-source.ts`，**默认dry-run**。必须显式提供 `VISITS_COPY_SOURCE_URL` 和 `VISITS_COPY_TARGET_URL`；工具不加载应用.env，不运行迁移、建角色或改变配置。

只有获批应用时才添加 `--apply`，并设置 `VISITS_COPY_CONFIRM_TARGET` 为实际目标数据库名。源连接应SELECT-only；目标连接仅授本次需要的读取和插入权限。不要把URL明文放进命令历史或报告。

工具使用来源repeatable-read快照及目标事务，校验17列schema一致、库身份不同、UUID/ref冲突。默认只报告数量与缺失UUID；执行只插入缺失原始行，原UUID/时间微秒/指纹/null全保留，精确回读校验；不更新/删除任何已有记录，不复制确认、询盘、来源关联或迁移历史。目标存在来源没有的新记录时保留。任一冲突整批拒绝，输出冲突UUID，不输出归因正文。最后增量必须在写入口转向生产、旧请求排空后重新执行和核对；一次dry-run不代表持续写入已收口。

## 本地隔离复现

创建仅绑定127.0.0.1:55457的临时PostgreSQL 16容器，密码 `isolation-ci-only`，不要使用本地业务PostgreSQL。执行 `pnpm exec ts-node test/website-visits-api.integration-check.ts`；测试自己创建随机两库、只读角色及临时TLS证书，结束删除。可通过 `ISOLATION_PG_PORT` / `ISOLATION_PG_PASSWORD` 指向另一个**专用本地隔离**实例，不支持远端业务库。

测试覆盖UUID/17字段精确复制、schema与数据冲突拒绝、两环境确认及询盘独立、真实JWT/HTTPS/数据库、机器密钥和IP限制、上游异常无副本回退、CSV及表单/JSON登记兼容。测试名称production/development只是本地随机测试库角色。

## 发布前待确认

准备当时版本、完整验证与业务隔离自测结果、生产库及配置备份、准确数据数量和UUID差异、短暂API重建窗口及回滚步骤后，再请求批准。先发布默认关闭的代码不会自动改变来源；最终来源配置与入口代理另按批准顺序执行。生产产生新访问后，回滚应用仍须保留生产为唯一来源，禁止整库还原或盲目把登记写回旧dev。DNS、旧dev生命周期、WhatsApp回调/中继及打包机不由本目录自动操作。
