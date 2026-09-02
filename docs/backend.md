# Sunrise TravelOps 后端说明

更新日期：2026-09-02

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
- 已保存前端原型使用的系统管理、资源、询盘和行程权限，并通过角色关联到种子用户；系统字典、业务字典和用户管理 API 已实现，其他业务管理 API 仍待接入。
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

### System Dictionaries

系统字典用于维护来源渠道、资源类型、状态原因等可扩展参考数据。本期实现与前端 `/system/dict`、`/system/dict-item` 页面一致的“字典 + 字典项”能力；编号规则、时区和完整系统参数不在本期范围内。业务字典使用下文的独立接口。

所有接口：

- 使用 `/api` 全局前缀并要求 Bearer Token。
- 管理接口使用页面对应的 `sys:dict:*` 或 `sys:dict-item:*` 权限；已启用选项查询只要求登录。
- 使用统一错误结构：`code`、`message`、`details`、`timestamp`、`path`。
- 删除为软删除，不物理清除分类或分类选项。

#### 分类接口

| 方法     | 路径                                     | 权限              | 说明                     |
| -------- | ---------------------------------------- | ----------------- | ------------------------ |
| `GET`    | `/api/system/dictionaries`               | `sys:dict:list`   | 分页查询分类             |
| `GET`    | `/api/system/dictionaries/options`       | `sys:dict:list`   | 查询已启用分类的下拉选项 |
| `GET`    | `/api/system/dictionaries/:id`           | `sys:dict:list`   | 查询分类表单数据         |
| `POST`   | `/api/system/dictionaries`               | `sys:dict:create` | 新增分类                 |
| `PUT`    | `/api/system/dictionaries/:id`           | `sys:dict:update` | 修改分类                 |
| `DELETE` | `/api/system/dictionaries?ids=:id1,:id2` | `sys:dict:delete` | 批量软删除分类及其选项   |

分页查询参数：

| 参数       | 类型     | 默认值 | 说明                               |
| ---------- | -------- | ------ | ---------------------------------- |
| `page`     | integer  | `1`    | 页码                               |
| `pageNum`  | integer  | -      | 前端兼容参数；存在时覆盖 `page`    |
| `pageSize` | integer  | `20`   | 每页数量，最大 `100`               |
| `keyword`  | string   | -      | 按分类名称或编码模糊搜索           |
| `keywords` | string   | -      | 前端兼容参数；存在时覆盖 `keyword` |
| `status`   | `0 \| 1` | -      | `0` 停用，`1` 启用                 |

分页响应返回 `list`、`total`、`page` 和 `pageSize`。前端当前只使用 `list` 与 `total`，额外分页元数据可以忽略。

分类写入示例：

```json
{
  "name": "来源渠道",
  "dictCode": "inquiry_source",
  "status": 1,
  "remark": "询盘来源渠道"
}
```

`dictCode` 会去除首尾空格并转换为小写，只允许小写字母开头以及小写字母、数字、下划线。编码全局唯一；已软删除的编码也不能直接复用，以保留恢复和历史引用能力。

修改时兼容前端表单携带的 `id`。如果请求体 `id` 与路径 ID 不同，返回 `DICTIONARY_ID_MISMATCH`。

#### 分类选项接口

| 方法     | 路径                                                     | 权限                   | 说明                     |
| -------- | -------------------------------------------------------- | ---------------------- | ------------------------ |
| `GET`    | `/api/system/dictionaries/:dictCode/items`               | `sys:dict-item:list`   | 分页查询分类选项         |
| `GET`    | `/api/system/dictionaries/:dictCode/items/options`       | 已登录                 | 按 `sort` 查询已启用选项 |
| `GET`    | `/api/system/dictionaries/:dictCode/items/:id`           | `sys:dict-item:list`   | 查询选项表单数据         |
| `POST`   | `/api/system/dictionaries/:dictCode/items`               | `sys:dict-item:create` | 新增分类选项             |
| `PUT`    | `/api/system/dictionaries/:dictCode/items/:id`           | `sys:dict-item:update` | 修改分类选项             |
| `DELETE` | `/api/system/dictionaries/:dictCode/items?ids=:id1,:id2` | `sys:dict-item:delete` | 批量软删除分类选项       |

分页参数与分类接口一致，同时支持 `status` 过滤；关键字会匹配选项名称或选项值。

选项写入示例：

```json
{
  "dictCode": "gender",
  "label": "男",
  "value": "1",
  "status": 1,
  "sort": 1,
  "tagType": "primary"
}
```

兼容前端表单提交的 `id` 和 `dictCode`，但路径参数始终是权威值。请求体与路径不一致时分别返回 `DICTIONARY_ID_MISMATCH` 或 `DICTIONARY_CODE_MISMATCH`。

同一分类下 `value` 唯一。`tagType` 可为：空字符串、`primary`、`success`、`info`、`warning`、`danger`。

启用选项查询响应：

```json
[
  {
    "value": "1",
    "label": "男",
    "tagType": "primary"
  }
]
```

该选项接口会被个人资料等普通业务页面使用，因此只要求登录，不要求系统分类管理权限。停用选项不会出现在响应中，但记录仍然保留，历史业务数据可继续通过稳定 ID 读取原始显示值。

#### 数据表与初始化数据

Migration `AddSystemDictionaries1788285600000` 新增：

- `system_dictionary_types`
- `system_dictionary_items`

分类选项通过 `type_id` 关联分类，因此修改 `dictCode` 不需要改写全部选项。两张表均有创建人、修改人、时间、乐观锁版本和软删除时间。

Migration 会按前端 `src/data/data.ts` 初始化：

- `gender`：男、女、未设置
- `common_status`：启用、禁用
- `yes_no`：是、否

执行：

```bash
pnpm migration:run
```

#### 业务错误码

| 错误码                         | HTTP 状态 | 说明                                |
| ------------------------------ | --------- | ----------------------------------- |
| `DICTIONARY_TYPE_NOT_FOUND`    | `404`     | 分类不存在或已删除                  |
| `DICTIONARY_ITEM_NOT_FOUND`    | `404`     | 当前分类下不存在该选项              |
| `DICTIONARY_TYPES_NOT_FOUND`   | `404`     | 批量删除包含不存在的分类 ID         |
| `DICTIONARY_ITEMS_NOT_FOUND`   | `404`     | 批量删除包含不属于当前分类的选项 ID |
| `DICTIONARY_CODE_EXISTS`       | `409`     | 分类编码重复                        |
| `DICTIONARY_ITEM_VALUE_EXISTS` | `409`     | 当前分类下选项值重复                |
| `DICTIONARY_ID_MISMATCH`       | `400`     | 请求体 ID 与路径 ID 不一致          |
| `DICTIONARY_CODE_MISMATCH`     | `400`     | 请求体分类编码与路径编码不一致      |

### Business Dictionaries

业务字典采用与系统字典一致的“字典类型 + 字典项”两层命名。`resource-unit`（资源计价单位）和 `transport-method`（交通方式）是内置类型；管理员可以新增自定义类型。所有接口要求 Bearer Token，并在后端校验 `sys:business-dictionary:*` 权限。

#### 业务字典类型接口

| 方法     | 路径                                             | 权限                             | 说明                                           |
| -------- | ------------------------------------------------ | -------------------------------- | ---------------------------------------------- |
| `GET`    | `/api/system/business-dictionaries`              | `sys:business-dictionary:list`   | 返回全部类型及其 `items`，可直接初始化页面     |
| `POST`   | `/api/system/business-dictionaries`              | `sys:business-dictionary:create` | 新增自定义类型                                 |
| `PUT`    | `/api/system/business-dictionaries/:id`          | `sys:business-dictionary:update` | 修改类型名称；内置类型不能修改编码             |
| `DELETE` | `/api/system/business-dictionaries?ids=:id1,...` | `sys:business-dictionary:delete` | 批量软删除自定义类型及其分类项；不能删内置类型 |

类型写入示例：

```json
{
  "name": "服务等级",
  "englishName": "Service Levels",
  "code": "service-level"
}
```

`code` 允许小写字母开头，以及字母、数字和连字符；编码全局唯一，软删除后仍不能复用。修改请求可以携带 `id`，但必须与路径 ID 一致。

列表响应与前端页面模型一致：

```json
[
  {
    "id": "10000000-0000-4000-8000-000000000001",
    "code": "resource-unit",
    "name": "资源计价单位",
    "englishName": "Resource Price Units",
    "builtIn": true,
    "items": []
  }
]
```

#### 业务字典项接口

| 方法     | 路径                                                             | 权限                             | 说明                         |
| -------- | ---------------------------------------------------------------- | -------------------------------- | ---------------------------- |
| `GET`    | `/api/system/business-dictionaries/:typeCode/items`              | `sys:business-dictionary:list`   | 查询指定类型的分类项         |
| `POST`   | `/api/system/business-dictionaries/:typeCode/items`              | `sys:business-dictionary:create` | 新增分类项                   |
| `PUT`    | `/api/system/business-dictionaries/:typeCode/items/:id`          | `sys:business-dictionary:update` | 修改分类项                   |
| `DELETE` | `/api/system/business-dictionaries/:typeCode/items?ids=:id1,...` | `sys:business-dictionary:delete` | 批量软删除指定类型下的分类项 |

查询支持可选的 `keyword` 和 `status`。`keyword` 同时匹配名称、英文名称和编码；`status` 为 `enabled` 或 `disabled`。分类项不分页，响应为数组。

分类项写入示例：

```json
{
  "code": "roomNight",
  "name": "间夜",
  "englishName": "Room night",
  "resourceTypes": ["hotel"],
  "status": "enabled",
  "remark": "酒店房型按间夜计价"
}
```

`resourceTypes` 可使用 `hotel`、`attraction`、`restaurant`、`vehicle`、`guide`。`resource-unit` 类型至少需要一个适用资源类型；其他类型会统一保存为空数组。同一类型下 `code` 唯一，软删除后仍不复用。

Migration `AddBusinessDictionariesAndUserManagement1788372000000` 会按前端 `src/data/data.ts` 初始化：

- `resource-unit`：间夜、人次、人/餐、桌、辆/天、人/天。
- `transport-method`：飞机、商务车、动车、旅游大巴、船、步行。

业务字典类型和字典项都有创建人、修改人、时间、乐观锁版本和软删除时间。当前旅游资源、行程仍在前端 Mock 中，因此删除字典项时尚不能在数据库中检查业务引用；接入这些领域后应在服务端增加“已使用不能删除”的引用校验。

主要错误码：

| 错误码                                           | HTTP 状态 | 说明                           |
| ------------------------------------------------ | --------- | ------------------------------ |
| `BUSINESS_DICTIONARY_TYPE_NOT_FOUND`             | `404`     | 业务字典类型不存在或已删除     |
| `BUSINESS_DICTIONARY_ITEM_NOT_FOUND`             | `404`     | 当前类型下分类项不存在或已删除 |
| `BUSINESS_DICTIONARY_TYPE_CODE_EXISTS`           | `409`     | 类型编码重复                   |
| `BUSINESS_DICTIONARY_ITEM_CODE_EXISTS`           | `409`     | 当前类型下分类项编码重复       |
| `BUILT_IN_BUSINESS_DICTIONARY_CODE_IMMUTABLE`    | `409`     | 尝试修改内置类型编码           |
| `BUILT_IN_BUSINESS_DICTIONARY_CANNOT_BE_DELETED` | `409`     | 尝试删除内置类型               |
| `BUSINESS_DICTIONARY_RESOURCE_TYPES_REQUIRED`    | `400`     | 资源计价单位未指定适用资源类型 |
| `RESOURCE_ID_MISMATCH`                           | `400`     | 请求体 ID 与路径 ID 不一致     |

### User Management

用户管理对应前端 `/system/user` 页面，包括分页筛选、表单回填、新增、修改、批量软删除、管理员重置密码，以及角色和部门下拉选项。所有接口要求 Bearer Token，并分别校验 `sys:user:list`、`create`、`update`、`delete` 或 `reset-password` 权限。

| 方法     | 路径                             | 权限                      | 说明                                 |
| -------- | -------------------------------- | ------------------------- | ------------------------------------ |
| `GET`    | `/api/users`                     | `sys:user:list`           | 分页查询用户                         |
| `GET`    | `/api/users/options/roles`       | `sys:user:list`           | 查询可分配且已启用的角色选项         |
| `GET`    | `/api/users/options/departments` | `sys:user:list`           | 查询部门选项                         |
| `GET`    | `/api/users/:id`                 | `sys:user:list`           | 查询用户表单数据                     |
| `POST`   | `/api/users`                     | `sys:user:create`         | 新增用户                             |
| `PUT`    | `/api/users/:id`                 | `sys:user:update`         | 修改用户资料、角色和启停状态         |
| `DELETE` | `/api/users?ids=:id1,:id2`       | `sys:user:delete`         | 批量软删除用户                       |
| `POST`   | `/api/users/:id/reset-password`  | `sys:user:reset-password` | 重置密码并撤销该用户的 Refresh Token |

分页参数：

| 参数         | 类型      | 默认值 | 说明                                 |
| ------------ | --------- | ------ | ------------------------------------ |
| `page`       | integer   | `1`    | 页码                                 |
| `pageNum`    | integer   | -      | 前端兼容参数；存在时覆盖 `page`      |
| `pageSize`   | integer   | `20`   | 每页数量，最大 `100`                 |
| `keyword`    | string    | -      | 搜索用户名、昵称或手机号             |
| `keywords`   | string    | -      | 前端兼容参数；存在时覆盖 `keyword`   |
| `status`     | `0 \| 1`  | -      | `0` 停用，`1` 启用                   |
| `deptId`     | integer   | -      | 部门 ID                              |
| `roleId`     | UUID      | -      | 角色 ID                              |
| `createTime` | string[2] | -      | 开始、结束日期；支持数组或逗号分隔值 |

响应返回 `list`、`total`、`page` 和 `pageSize`。列表项和表单详情都返回 `deptId`、`deptName`、`roleIds`、逗号连接的 `roleNames`，并将状态映射为前端使用的 `0 | 1`。

用户写入示例：

```json
{
  "username": "operations_li",
  "nickname": "李明",
  "avatar": "",
  "gender": 0,
  "mobile": "",
  "email": "operations.li@sunrise.local",
  "deptId": 3,
  "roleIds": ["角色 UUID"],
  "status": 1
}
```

新增时可以额外提交 6 至 128 位的 `password`。如果省略，后端会生成高强度随机初始密码，并只在本次 `201` 响应的 `temporaryPassword` 字段中返回；前端必须立即展示或安全交付，此后无法再次读取。数据库始终只保存 Argon2 哈希。

更新时不要求提交 `username`。为兼容旧调用方，请求仍可携带原用户名，但如果与数据库中的用户名不同会返回 `USERNAME_IMMUTABLE`。停用用户会立即清除其 Refresh Token，现有 Access Token 在下一次鉴权加载用户时也会因状态失效。角色选项不暴露内部 `ROOT` 角色；更新已有 Root 用户时后端会保留其 Root 角色，避免普通表单误删。

密码重置请求：

```json
{
  "password": "新的安全密码"
}
```

用户删除采用软删除，并清除 Refresh Token。当前登录用户不能删除或停用自己；拥有 `ROOT` 角色的账号不能删除。用户名即使软删除后也不允许复用，以保留审计和历史关联。

部门当前是 P0 固定配置：系统管理部、资源管理部、计调部；角色来自数据库 `roles` 表。部门后续如果需要独立维护，再迁移为部门实体，不在用户表中重复保存部门名称。

主要错误码：

| 错误码                              | HTTP 状态 | 说明                                         |
| ----------------------------------- | --------- | -------------------------------------------- |
| `USER_NOT_FOUND`                    | `404`     | 用户不存在或已删除                           |
| `USERS_NOT_FOUND`                   | `404`     | 批量删除包含不存在的用户 ID                  |
| `USERNAME_EXISTS`                   | `409`     | 用户名已存在                                 |
| `USERNAME_IMMUTABLE`                | `409`     | 尝试修改用户名                               |
| `CURRENT_USER_CANNOT_BE_DISABLED`   | `409`     | 当前用户尝试停用自己                         |
| `CURRENT_USER_CANNOT_BE_DELETED`    | `409`     | 当前用户尝试删除自己                         |
| `ROOT_USER_CANNOT_BE_DELETED`       | `409`     | 尝试删除 Root 账号                           |
| `ROLES_NOT_FOUND_OR_NOT_ASSIGNABLE` | `400`     | 角色不存在、已停用或属于不可分配的 Root 角色 |
| `DEPARTMENT_NOT_FOUND`              | `400`     | 部门 ID 不在 P0 固定配置中                   |
| `RESOURCE_ID_MISMATCH`              | `400`     | 请求体 ID 与路径 ID 不一致                   |

相关 Migration 还会给 `users` 增加乐观锁版本和软删除时间，并为未删除用户的状态查询建立索引。

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
