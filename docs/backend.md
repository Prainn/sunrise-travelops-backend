# Sunrise TravelOps 后端说明

更新日期：2026-09-01

## 已实现功能

### Auth

| 方法   | 路径                | 鉴权         | 说明                                                     |
| ------ | ------------------- | ------------ | -------------------------------------------------------- |
| `POST` | `/api/auth/login`   | 否           | 使用用户名和密码登录，返回 Access Token 与 Refresh Token |
| `POST` | `/api/auth/refresh` | 否           | 校验并轮换 Refresh Token，返回一组新 Token               |
| `POST` | `/api/auth/logout`  | Bearer Token | 清除当前用户保存的 Refresh Token，响应状态码为 `204`     |
| `GET`  | `/api/auth/me`      | Bearer Token | 返回当前用户 ID、用户名和权限列表                        |

认证实现包括：

- 使用 Argon2 保存密码哈希和 Refresh Token 哈希。
- Access Token 与 Refresh Token 使用不同密钥和有效期。
- JWT 只保存用户 ID 和 Token 类型，不携带角色、权限或用户资料；请求鉴权时从数据库加载当前用户及权限，避免 Token 过长，并让停用用户和权限变更立即生效。
- 每次刷新都会轮换 Refresh Token；退出后旧 Refresh Token 失效。
- 只有 `enabled` 状态用户可以登录和刷新 Token。
- 全局 JWT Guard 与权限 Guard；公开接口通过 `@Public()` 声明。
- 登录接口每分钟最多 5 次请求，刷新接口每分钟最多 10 次请求。
- 已保存前端原型使用的系统管理、资源、询盘和行程权限，并通过角色关联到种子用户；目前尚无对应业务管理 API。
- 登录和本地用户初始化的密码最小长度为 6 位；数据库只保存 Argon2 哈希，不保存明文密码。

认证相关数据库表：

- `users`
- `roles`
- `permissions`
- `user_roles`
- `role_permissions`

用户资料字段包括：用户名、昵称、头像、性别、手机号、邮箱、部门 ID、状态和创建时间。前端 Mock 中的 `roles`、`roleIds` 与 `perms` 通过角色、权限及其关联表表达，`roleNames` 是展示派生值，不重复存储。

### 本地种子用户

`users:seed` 会按用户名幂等创建或更新以下开发用户，并同步角色与权限：

| 用户名                | 昵称     | 角色                     |
| --------------------- | -------- | ------------------------ |
| `admin`               | admin    | `ROOT`、`ADMIN`          |
| `inquiry`             | 王敏     | `INQUIRY_COORDINATOR`    |
| `resource`            | resource | `RESOURCE_MANAGER`       |
| `operations`          | 张伟     | `OPERATIONS_COORDINATOR` |
| `inquiry_lina`        | 李娜     | `INQUIRY_COORDINATOR`    |
| `inquiry_zhouyue`     | 周悦     | `INQUIRY_COORDINATOR`    |
| `operations_chenchen` | 陈晨     | `OPERATIONS_COORDINATOR` |
| `operations_zhaolei`  | 赵磊     | `OPERATIONS_COORDINATOR` |

执行前先运行 Migration，然后通过临时环境变量提供至少 6 位的开发密码：

```bash
pnpm migration:run
SEED_USER_PASSWORD="<本地开发密码>" pnpm users:seed
```

种子脚本不会把明文密码写入源码或数据库；重复执行会更新上述用户，不会重复插入。

### Health

| 方法  | 路径          | 鉴权 | 说明                                   |
| ----- | ------------- | ---- | -------------------------------------- |
| `GET` | `/api/health` | 否   | 检查 NestJS API 和 PostgreSQL 连接状态 |

API 与数据库均正常时返回 `200`；任一健康检查失败时返回非 `2xx` 状态。

## 当前公共能力

- API 全局前缀：`/api`
- 开发服务端口：`4000`
- Swagger：`http://localhost:4000/api/docs`
- DTO 校验：自动转换、白名单过滤并拒绝未声明字段
- 统一错误响应：`code`、`message`、`details`、`timestamp`、`path`
- Pino 结构化日志与请求 ID；认证头、密码和 Refresh Token 会被脱敏
- Helmet、CORS、全局限流和优雅关闭
- PostgreSQL 16、TypeORM Migration、Docker Compose

启动、Migration 和 Docker 命令见根目录 [README](../README.md)。

## 待办

### 后端业务能力

- Costing Sheet/Line、Quote/Version/Line、版本锁定和不可变快照由后端实现。
- 后端根据锁定的 Quote Version 生成、保存并返回正式 PDF，同时记录文件哈希、生成人、服务端生成时间和历史文件。
- 状态变化、审计日志和版本快照必须在同一数据库事务中原子完成；前端只调用一个业务命令接口，并使用服务端结果刷新界面。
- 后端必须重复校验角色、动作和数据范围，不能只依赖前端的菜单或按钮权限。
- 旅行社维护统一邮箱和多个联系人；联系人只包含稳定 ID、姓名和电话。
- 询盘保存旅行社与联系人的引用，邮箱固定取旅行社邮箱。
- 询盘内新增联系人必须通过后端接口同步到当前旅行社；接口需要处理同一旅行社下的重复姓名，并返回最终联系人记录，不能只保存自由文本。

### 报价、金额与时间契约

- 前端原型目前按 10% 目标利润率生成建议成人价；用户手工修改后使用用户价格。正式接入时由后端重新计算并返回最终建议价。
- 明确利润率精度、金额精度和四舍五入顺序。
- 人民币金额使用两位小数；API 优先使用十进制定点字符串，前端继续用整数分计算，并在接口边界统一转换。
- 时间点使用带时区的 ISO 8601，日期字段使用 `YYYY-MM-DD`。
- 服务端以 UTC 保存时间点，前端按业务时区展示；PDF 使用后端返回的可信生成时间。
- 创建版本、生成 PDF 等命令需要支持幂等键和重复提交保护。

### API 契约与前端接入

- 每个领域分别定义 list item、detail、create input、update input、query 和 page result 类型。
- 页面 Form 类型只包含可编辑字段，不直接复用 API Detail，也不携带服务端生成字段。
- 在前端 service 层集中映射 API 数据和页面模型，页面不直接调用 `fetch` 或具体请求库。
- 统一 base URL、超时、认证头、Refresh Token 单飞、取消请求、错误映射、分页、筛选、排序和响应解包。
- 为旅行社列表、详情、联系人列表、联系人新增/修改和询盘联系人选项分别定义接口类型；联系人不包含部门字段。

### 联调与回归

1. 固定 Node.js 与 pnpm 版本，并执行 `pnpm install --frozen-lockfile`。
2. 前端依次执行 `pnpm type-check`、`pnpm test`、`pnpm lint`、`pnpm build`，保存命令、版本和结果。
3. 建立四类角色账号的权限矩阵回归，覆盖菜单、按钮、越权入口和只读状态。
4. 建立主链路手工用例：登录 → 资源维护 → 创建询盘 → 创建/复制 Draft → 编辑每日资源 → 验证 10% 建议价 → 手工改价 → PDF 预览/取消/确认下载 → Quoted 只读 → 查看日志。
5. 为每条用例固定 Mock 输入以及预期状态、金额、日志条数和 PDF 关键文本，并保留截图或录屏证据。
6. 优先将登录、询盘到报价 PDF 的主链路补为 Playwright E2E；后端接入后使用同一批用例做契约和回归验收。

待办来源：[前端接入后端待办](../../sunrise-travel-ops-web/docs/backend-integration-todo.md)。
