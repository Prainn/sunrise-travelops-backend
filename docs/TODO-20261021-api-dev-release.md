# 菜单树、航班搜索、团号建议后端dev发布

用户授权：提交本会话涉及的后端修改并部署dev。仅后端dev；不发布前端、不操作生产。应用部署按当前AGENTS/workflow执行，技能旧main发布叙述不适用于本项目现行dev/main环境映射。实现阶段的“不用验证”已记录；本次正式发布执行后端强制verify:release及必要权限/线上只读验收。

- [x] 核对候选文件、远端dev、dev在线版本及迁移，运行发布门禁。
- [~] 仅提交本任务业务改动及必要依赖/记录，推送dev并绑定准确Actions。
- [ ] 等待构建部署，核对release/image/health及新接口。
- [ ] 保存发布证据及AOCI状态。

候选：roles菜单树/导航接口，tours航班分页搜索，users团号建议及对应去重/总部可空规则（既有完整功能），pinyin-pro依赖、USER_TOUR_CODE_EXISTS及相关测试/记录。不包含其他任务的.github/workflows/deploy.yml、scripts/deploy.py、scripts/test_deploy.py、旧发布记录改动和生产账号维护记录。

初始状态：dev=origin/dev=3c47e06796a39f7c6c060a83f740d84c8b7a2eae；origin/main=9be0104（不操作）。dev在线release=3c47e06796a39f7c6c060a83f740d84c8b7a2eae-39551552926-1，image=sha256:58fd9e83772d8efa4f09de5b61ba65aa3094e6af87278e8f6734e453b8c8f521，healthy。目标/opt/sunrise-travelops-dev，业务库travelops_dev。

接口变更：菜单GET由menus改groups；航班GET由数组改分页对象。用户明确要求先部署后端，前端接入prompt已交付，本任务不擅自发布前端。共享根docs已更新但不随子仓提交交付。无本任务新增migration；需核对目标已执行集合后确认pending。

发布门禁：本次源码格式调整后pnpm verify:release通过（69迁移命名、全量ESLint、Nest build）；根node scripts/check-role-permissions.cjs通过（191接口、26受保护路由、14角色/范围用例）。目标库current_database=travelops_dev；候选编译产物中的实际migration类名称与业务库已执行69项一致，pending=[]。无迁移、无业务数据更新；应用失败可按现行网关恢复上一同schema镜像。早期临时SQL文本正则误把name赋值内容识别成迁移名，已改用编译后的MigrationInterface实例实际name核对，未执行任何迁移写操作。
