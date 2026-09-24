# Sunrise TravelOps Backend

## 环境要求

- Node.js 24 LTS
- pnpm 11
- PostgreSQL 16，或 Docker Desktop

## 配置环境变量

修改 `.env` 中的数据库密码、JWT 密钥和 CORS 来源。开发环境默认使用 `travelops_dev`；生产环境应使用独立的 `travelops_prod` 数据库和凭据。

## 本地启动

安装依赖：

```bash
pnpm install
```

使用 Docker 启动 PostgreSQL：

```bash
docker compose up -d postgres
```

执行数据库 Migration：

```bash
pnpm migration:run
```

启动后端开发服务：

```bash
pnpm start:dev
```

默认地址：

- API：`http://localhost:4000/api`
- Health Check：`http://localhost:4000/api/health`
- Swagger：`http://localhost:4000/api/docs`

## Docker Compose 启动

以下为本地 Compose。ECS 双环境使用 `compose.ecs.yml`，dev 追加 `compose.dev.yml`，共享入口使用 `compose.ingress.yml`，部署与服务器管理员命令统一维护在 workspace 的 `docs/deployment/ECS开发环境部署.md`。

```bash
docker compose up --build
```

Compose 会依次启动 PostgreSQL、执行 Migration、启动后端和 Nginx。后端可通过 `http://localhost:4000/api` 直接访问，也可通过 Nginx 地址 `http://localhost:8080/api` 访问。

查看日志：

```bash
docker compose logs -f api
docker compose logs -f postgres
docker logs -f --since 10m <api-container>
```

开发服务 `pnpm start:dev` 使用 pino-pretty 显示本地时间；Docker 中的生产配置保持一行一条的结构化 JSON。正常 `/api/health` 200 不写普通 access log，异常 health 仍会记录。

启动独立日志 UI Dozzle：

```bash
docker compose up -d dozzle
docker compose ps
```

浏览器打开 `http://127.0.0.1:8081`。Dozzle 左侧时间使用浏览器本地时区显示，结构化日志内的 ISO 8601 UTC `time` 原值不变。可搜索 `whatsapp`、requestId、controller context、handler 和日志级别；它不被 API、PostgreSQL 或 Nginx 依赖。停止 Dozzle 不影响业务服务：

```bash
docker compose stop dozzle
```

ECS 的 8081 仍只绑定 localhost；dev 外部通过 `https://dev-log.sunrisevacation.cn`，prod 通过 `https://log.sunrisevacation.cn` 反向代理到各自 Dozzle，并启用 Dozzle simple auth。部署和 DNS 说明见 workspace 的 `docs/deployment/ECS开发环境部署.md`。

停止服务：

```bash
docker compose down
```

## Migration 命令

```bash
pnpm migration:show
pnpm migration:run
pnpm migration:revert
pnpm migration:generate src/migrations/DescribeChange
```
