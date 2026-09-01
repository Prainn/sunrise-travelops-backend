---
name: sunrise-travelops-backend
description: Build, review, and maintain the Sunrise TravelOps V1 backend using NestJS 11, TypeORM 0.3.x, PostgreSQL 16, quotation snapshots, travel-operations domain naming, JWT/RBAC, migrations, structured logging, security defaults, testing, Docker Compose, and Nginx.
---

# Sunrise TravelOps Backend Skill

## Purpose

Use this skill whenever creating, reviewing, modifying, or extending the Sunrise TravelOps backend.

Current implemented scope is limited to `Auth` and `Health`. Keep `users` and `roles` only as authentication/RBAC support. Do not add Quotations or any other business module until the user explicitly requests that module; the later domain sections define how to implement those modules when they enter scope.

The system is a travel-agency operations / itinerary / quotation platform. Use the actual travel-business domain language in code. Do not force generic ecommerce terminology into the model.

Optimize V1 for:

- business correctness
- maintainability
- historical consistency
- database integrity
- clear domain boundaries
- safe deployment
- incremental evolution

Prefer boring and explicit architecture over speculative infrastructure.

Before changing code, inspect the current repository, existing frontend types, dependencies, configuration, migrations, database entities, and deployment setup.

Reuse reasonable existing code and avoid unnecessary rewrites.

---

# 1. Core Stack

Use:

- Node.js LTS
- NestJS 11
- TypeORM 0.3.x
- PostgreSQL 16
- `@nestjs/swagger`
- Passport
- JWT Access Token + Refresh Token
- RBAC
- `nestjs-pino`
- `@nestjs/terminus`
- `@nestjs/throttler`
- Helmet
- bcrypt or argon2
- Docker Compose
- Nginx

Do not introduce without a concrete present requirement:

- Redis
- BullMQ
- Kafka
- RabbitMQ
- Elasticsearch
- Kubernetes
- microservices
- CDN
- PostgreSQL replicas
- read/write splitting

If one becomes necessary, first explain:

1. the concrete business problem
2. why the current architecture cannot reasonably solve it
3. the added operational cost

---

# 2. Domain Naming

Use actual Sunrise TravelOps domain names.

Preferred modules:

```text
src/
├── auth/
├── users/
├── roles/
├── inquiries/
├── itineraries/
├── resources/
├── quotations/
├── system/
├── dashboard/
├── common/
├── config/
├── database/
└── migrations/
```

Domain meanings:

```text
inquiries
→ inquiry records and inquiry workflow

itineraries
→ itinerary, daily plans, itinerary resource items

resources
→ travel agencies, DMCs, hotels, restaurants, attractions,
  vehicles, guides and other supplier/resource master data

quotations
→ quotation calculation, quotation versions and snapshots

system
→ dictionaries, business categories, pricing units,
  transportation modes and system reference data

dashboard
→ operational dashboard statistics
```

Avoid generic ecommerce naming such as:

```text
orders
products
customers
payments
```

when it would create a semantic mismatch with the actual business model.

Never map "Inquiry" to `Order` merely because both represent a workflow record.

Never map hotels or attractions to generic `Product` if the actual domain concept is a travel resource.

Backend names should align with frontend business types where practical, including `InquiryRecord`.

---

# 3. Architecture

Use a modular monolith.

Do not split V1 into microservices.

Responsibilities:

```text
Controller
→ HTTP request/response, DTO parsing, invocation of services

Service
→ business logic, state transitions, calculations, transactions

Repository / TypeORM
→ database access
```

Do not place substantial business logic in controllers.

Avoid meaningless abstractions and premature design patterns.

---

# 4. API Conventions

Use global prefix:

```text
/api
```

Examples:

```text
/api/auth
/api/users
/api/inquiries
/api/itineraries
/api/resources
/api/quotations
/api/system
/api/dashboard
/api/health
```

Use:

- DTOs
- `class-validator`
- global `ValidationPipe`
- `whitelist`
- `transform`
- centralized exception handling

Swagger module/group display names must start with an uppercase English letter. Use values such as `Auth`, `Quotations`, and `Health` in `@ApiTags()`. Keep URL paths lowercase, such as `/api/auth`, `/api/quotations`, and `/api/health`.

Never rely on frontend validation alone.

---

# 5. PostgreSQL

Use PostgreSQL 16.

Development and production databases must be separated:

```text
travelops_dev
travelops_prod
```

All database configuration must come from environment variables.

Typical variables:

```text
NODE_ENV

DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD

JWT_SECRET
JWT_EXPIRES_IN

REFRESH_TOKEN_SECRET
REFRESH_TOKEN_EXPIRES_IN

CORS_ORIGIN
```

Provide `.env.example`.

Never commit actual secrets.

Application business code must not depend on whether PostgreSQL runs locally, in Docker, on ECS, or on RDS.

---

# 6. TypeORM and Migrations

Use TypeORM 0.3.x.

Never rely on:

```ts
synchronize: true
```

in production.

All schema changes use migrations.

Workflow:

```text
Modify Entity
→ Generate Migration
→ Review generated SQL
→ Run against development database
→ Test
→ Run against production database
```

Provide scripts for:

```text
migration:generate
migration:run
migration:revert
migration:show
```

Migration files belong in Git.

---

# 7. Financial Precision

Never use PostgreSQL `FLOAT` or `DOUBLE` for commercial amounts.

Examples:

```text
resource_cost        NUMERIC(18, 2)
customer_unit_price  NUMERIC(18, 2)
total_amount         NUMERIC(18, 2)
```

Exchange rates may use:

```text
exchange_rate NUMERIC(18, 8)
```

Do not casually convert PostgreSQL NUMERIC into JavaScript `number` for authoritative financial calculations.

Prefer:

- string
- Decimal.js
- another reliable existing decimal implementation

The backend owns authoritative quotation calculations.

---

# 8. Quotation Snapshots

Quotation snapshots are a mandatory business rule.

When an internal user clicks **“生成报价”**, the backend must freeze the commercial data used at that exact moment.

The snapshot must be persisted in:

```text
quotation_snapshots
```

Recommended columns:

```text
id
quotation_id
version
snapshot_data JSONB
created_at
created_by
```

Use additional relational fields only where they provide clear querying, indexing, or integrity value.

## Snapshot contents

At minimum, freeze the authoritative values used to reproduce the quotation:

- resource ID
- resource display name
- resource cost
- customer unit price
- quantity
- currency
- exchange rate
- line totals
- total quotation amount
- relevant pricing units
- other pricing inputs used by the calculation

Example conceptual JSON:

```json
{
  "currency": "USD",
  "exchangeRate": "7.18320000",
  "items": [
    {
      "resourceId": 123,
      "resourceName": "Example Hotel",
      "resourceCost": "80.00",
      "customerUnitPrice": "100.00",
      "quantity": 2,
      "lineTotal": "200.00"
    }
  ],
  "totalAmount": "200.00"
}
```

Adapt the exact structure to the real domain model.

## Snapshot invariants

After snapshot creation:

- changing hotel cost does not alter the snapshot
- changing restaurant cost does not alter the snapshot
- changing attraction price does not alter the snapshot
- changing customer-facing price does not alter the snapshot
- changing exchange rate does not alter the snapshot
- renaming or editing a resource must not silently rewrite historical quotation data
- reopening an old quotation must preserve the original commercial result
- downloading the PDF months later must use the original snapshot

A quotation created in March must not change when resource prices change in May.

The snapshot is historical business data, not a cache.

## Quote versions

When commercial values change and a new quotation is generated:

```text
Quotation
├── Snapshot v1
├── Snapshot v2
└── Snapshot v3
```

Create a new snapshot/version.

Do not overwrite the previous snapshot.

This forms the foundation for future Quote Version comparison.

## Authoritative data

Never trust frontend-submitted:

- resource cost
- exchange rate
- final total
- customer unit price

as authoritative.

When generating a quotation:

```text
Frontend requests quotation generation
→ Backend reloads authoritative resource/pricing data
→ Backend calculates amounts
→ Backend freezes snapshot
→ Backend persists snapshot
→ Backend returns QuotationPdfData from snapshot
```

Snapshot persistence and quotation version/state updates should use a transaction where atomicity matters.

---

# 9. Quotation PDF

V1 quotation PDFs are generated in the frontend.

Correct flow:

```text
Internal user clicks 生成报价
→ NestJS validates quotation state
→ NestJS loads authoritative data
→ NestJS calculates commercial values
→ NestJS writes quotation_snapshots
→ NestJS returns frozen QuotationPdfData
→ Vue renders/generates PDF
→ Preview / Download / Send
```

`GET /api/quotations/:id/pdf-data` must return snapshot data.

It must not perform a live join against current hotel, restaurant, attraction, vehicle, guide, or other resource prices and recalculate an old quotation.

The frontend may format the PDF but must not independently recalculate authoritative commercial values from editable page state.

Define a dedicated DTO such as:

```text
QuotationPdfData
```

Do not expose complete TypeORM entities as PDF payloads.

Do not add backend PDF infrastructure in V1 unless required.

Defer:

- Puppeteer
- Playwright PDF generation
- BullMQ
- Redis
- PDF workers

until requirements include archiving, automatic generation, bulk jobs, retries, or long-running processing.

---

# 10. JSONB

Good JSONB use cases:

- quotation snapshots
- external API payloads
- irregular extension metadata
- product/resource-specific dynamic configuration

Use ordinary relational columns for data frequently used in:

- filtering
- sorting
- joins
- reporting
- grouping
- constraints

Do not reduce core domain entities to:

```text
id + giant JSONB data
```

---

# 11. Soft Delete

Important business data should not normally be physically deleted.

Use TypeORM:

```ts
@DeleteDateColumn()
deletedAt: Date | null;
```

Apply where appropriate to:

- inquiries
- itineraries
- resource master data
- quotations
- system master/reference data that may be historically referenced

Use TypeORM soft-delete behavior so normal queries exclude deleted rows by default.

Support recovery when business requirements allow it.

Do not confuse:

```text
archived
```

with:

```text
deleted
```

An archived inquiry can remain an active historical record.

Soft deletion is a separate persistence concern.

---

# 12. Time and Timezone

Time handling must be deliberate.

Rules:

- store actual timestamps in UTC
- return API timestamps in ISO 8601 with timezone
- frontend converts timestamps for the user's display timezone
- distinguish business dates from instants

Examples:

```text
created_at
updated_at
login_at
quotation_generated_at
```

are instants and should use timezone-aware timestamps.

Examples:

```text
itinerary_date
departure_date
check_in_date
check_out_date
```

may be business calendar dates and should not shift merely because the viewer changes timezone.

Prefer:

```text
DATE
```

for timezone-independent business dates.

Prefer:

```text
TIMESTAMPTZ
```

for real moments in time.

Do not blindly run timezone conversion on every date-like value.

---

# 13. Security Defaults

## Helmet

Enable Helmet security headers.

## CORS

Production CORS must allow only configured frontend origins.

Do not use unrestricted `origin: *` for authenticated production APIs.

## Authentication rate limiting

Use `@nestjs/throttler`.

In V1, in-memory throttling is acceptable.

Do not introduce Redis solely for login throttling.

Protect at least:

- login
- refresh-token endpoint
- other authentication endpoints vulnerable to brute-force attempts

## Passwords

Hash passwords using:

- bcrypt
- or argon2

Never store plaintext passwords.

Never log:

- passwords
- access tokens
- refresh tokens
- database credentials
- unnecessary sensitive data

---

# 14. Authentication and RBAC

Use:

- Passport
- JWT Access Token
- Refresh Token
- RBAC

Conceptual model:

```text
User
→ Role
→ Permission
```

Example permissions:

```text
inquiry:view
inquiry:create
inquiry:update
inquiry:archive

itinerary:view
itinerary:update

resource:view
resource:create
resource:update

quotation:view
quotation:create
quotation:update
quotation:generate

system:manage
user:manage
```

Use centralized Guards and decorators.

Avoid spreading:

```ts
if (user.role === 'admin')
```

through controllers and services.

Do not store refresh tokens insecurely in plaintext.

---

# 15. Pagination

All list endpoints should use a common pagination convention aligned with the frontend `usePageTable.ts`.

Request example:

```text
?page=1&pageSize=20&keyword=xxx&status=planning
```

Response:

```json
{
  "list": [],
  "total": 156,
  "page": 1,
  "pageSize": 20
}
```

Create reusable pagination DTOs/types/helpers.

Do not let each module invent a different pagination response format.

---

# 16. Error Response Contract

Use a stable error envelope.

Example:

```json
{
  "code": "INQUIRY_NOT_EDITABLE",
  "message": "当前询盘状态不可编辑",
  "details": {},
  "timestamp": "2026-08-27T18:00:00Z",
  "path": "/api/inquiries/123"
}
```

Requirements:

- `code` is a stable machine-readable business/system code
- frontend can map `code` to localized messages
- `message` is safe for client display where appropriate
- `details` is structured, not a raw exception dump
- `timestamp` is ISO 8601
- `path` identifies the endpoint

Never return raw PostgreSQL or TypeORM exceptions to clients.

Never expose production stack traces in API responses.

Translate expected constraint errors into appropriate application errors.

---

# 17. Logging

Use `nestjs-pino`.

Logs should be structured JSON.

Every request should have a `requestId`.

Useful fields:

```text
requestId
userId
method
url
statusCode
responseTime
error stack
```

Operational logs and business audit logs are different concepts.

Do not try to reconstruct all business history exclusively from application logs.

Docker runtime logs should be readable with:

```bash
docker compose logs -f api
```

Do not use PM2 inside Docker.

---

# 18. Auditability

Important business entities should normally include:

```text
created_at
created_by
updated_at
updated_by
```

Especially:

- inquiries
- itineraries
- resources
- quotations
- quotation_snapshots
- users
- roles
- system master data

Design important state changes so future Audit Log support can be added without rewriting the domain.

Quotation snapshots themselves are part of commercial history.

---

# 19. Health Check

Use `@nestjs/terminus`.

Provide:

```text
GET /api/health
```

At minimum verify:

- NestJS is responsive
- PostgreSQL is reachable

Keep the endpoint suitable for Docker, Nginx, ECS, or cloud health checks.

---

# 20. Swagger

Use `@nestjs/swagger`.

Path:

```text
/api/docs
```

Development can expose it normally.

Production should support protection by:

- Basic Auth
- IP allowlist
- administrator access
- or private network access

Swagger definitions should derive from and stay aligned with actual DTOs.

---

# 21. Testing

NestJS uses Jest.

At minimum, maintain meaningful tests around high-risk business logic.

## Service unit tests

Prioritize:

- inquiry state transitions
- quotation calculation
- exchange-rate calculation
- quotation snapshot creation
- quote version behavior
- historical snapshots remaining unchanged after resource price updates
- soft-delete behavior where important

## Auth e2e

Cover:

- login
- access token
- refresh token
- permission rejection
- basic throttling behavior

CI should at minimum run:

```bash
pnpm test
pnpm build
```

When lint is configured:

```bash
pnpm lint
```

Follow the same engineering habit already used by frontend tests such as money calculation and state-machine tests.

---

# 22. Docker

Use Docker Compose.

Development may contain:

```text
api
postgres
```

Production may evolve to:

```text
Nginx
API Container
RDS PostgreSQL
```

Do not use PM2 inside Docker.

Production starts NestJS with:

```bash
node dist/main.js
```

Use a multi-stage Dockerfile.

Production image should not run:

- dev mode
- nodemon
- file watchers

Configure appropriate restart and healthcheck behavior.

---

# 23. Nginx

Nginx is the HTTP/HTTPS entry point.

Responsibilities:

- TLS termination
- frontend static assets
- `/api` reverse proxy
- forwarded request metadata

Forward:

```text
Host
X-Real-IP
X-Forwarded-For
X-Forwarded-Proto
```

PostgreSQL port `5432` must not be publicly exposed.

---

# 24. Backup

If PostgreSQL runs on ECS initially:

```text
PostgreSQL
→ pg_dump
→ scheduled backup
→ OSS
```

Never keep the only database backup on the same ECS.

If migrating to Alibaba Cloud RDS PostgreSQL:

- enable automated backups
- configure retention
- verify restore procedures

A backup strategy is only valid if restoration is possible.

---

# 25. Working Method

For every backend task:

1. inspect current implementation first
2. check frontend/domain types where semantics matter
3. identify the smallest correct change
4. preserve existing correct behavior
5. use migrations for schema changes
6. keep business terminology consistent
7. add or update tests for high-risk logic
8. run available validation commands
9. clearly report migrations, config changes, and operational steps

Run relevant checks where available:

```text
TypeScript compilation
lint
Jest
Nest build
migration validation
Docker build
```

Do not claim a check passed unless it was actually executed.

---

# 26. Current Priority

Highest priority:

```text
correct travel-domain naming
NestJS 11
TypeORM 0.3.x
PostgreSQL 16
Migration
dev/prod database isolation
quotation snapshots
Quote Version foundation
financial precision
soft delete
timezone correctness
DTO validation
JWT + Refresh Token
RBAC
Helmet
CORS
login throttling
password hashing
common pagination
stable error contract
structured logging
requestId
health check
tests
Docker Compose
Nginx
HTTPS
database backup
```

Defer until real demand exists:

```text
Redis
BullMQ
backend PDF generation
CDN
microservices
distributed infrastructure
```

Keep V1 explicit, transactional, historically correct, and understandable to the next engineer who opens the repository.
