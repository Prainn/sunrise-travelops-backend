# 后端统一菜单树与顺序

授权：用户指定系统管理→询盘→独立站询盘→旅游资源库→导游管理→数据台账，要求后端修复分组及子菜单顺序、提供动态加载接口和前端prompt。前端不在本任务实现；两端均不运行验证，不提交/推送/发布。

- [x] 更新需求/API，建立共用有序菜单树，保留已有授权键与角色快照。
- [x] 菜单权限管理接口返回完整树；新增当前身份导航接口，按当前身份、实时权限和登录快照筛选。
- [x] 更新Swagger/架构说明及前端交接prompt，记录AOCI收尾结果。
- [!] AOCI未对齐：无关历史漂移阻塞，待独立维护。

设计：本地前端保留页面组件/路由注册和URL访问门禁；后端只提供受支持routeName、i18n标题、授权键及有序分组，不下发可执行组件。管理接口改为{groups,roles}；导航接口GET /api/system/menu-permissions/navigation返回{groups}。首页固定、个人中心隐藏，不进入可配置树。两询盘节点使用唯一节点key但共享menuKey=inquiries，保存仍为去重授权键，不迁移角色数据/旧JWT。

真实链路：roles/menu-definitions.ts→menu-permissions.service.ts/controller.ts；前端views/system/menu-permissions、stores/permission.ts、router/index.ts/access.ts。前端既有数组接口待prompt任务切换；发布需配套。

按用户要求不运行测试、lint、类型检查、build、check-role-permissions或接口/浏览器验证。不得将未执行验证记录为通过。

已修改：src/roles/menu-definitions.ts、menu-permissions.service.ts、menu-permissions.controller.ts，新增menu-navigation.dto.ts；根docs/requirements/P0.1-组织隔离与结构化业务.md、docs/api/Sunrise TravelOps 后端说明.md、docs/architecture/overview.md。保存DTO数量上限由旧常量19改为授权目录实际长度，确保完整勾选可提交；授权键集合、数据库与JWT格式不变。

交付：outputs/2026-10-21-统一菜单树-前端Prompt.txt。前端源码未改，旧菜单页仍消费menus扁平结构，需先按prompt接入groups和navigation，再配套发布。后端新navigation只读，使用JWT守卫提供的当前身份与实时权限，不执行配置表查询；管理GET/PUT继续仅总部ROOT。没有生产或开发环境写入。

AOCI单次收尾stopped/blocked：logical_plan=ffed4634752c5e90b7fd6bfb5a4d8af0ada680b68bad30418b69e2d2596fed7c；batch_identity=35378aed9110a7ec7a39146b19e4062fd73fd558e4d00cd287c639e49509a985。147目标、included=0，含无关漂移及vercel.json孤儿。pending_transactions=0、recovery_pending=false、third_party_conflict=false，未写正式索引。普通维护无本任务路径范围能力；按根规则不裁剪、不扩修，独立维护从最新Guide重新计划。未运行Verify/Check或任何代码验证。
