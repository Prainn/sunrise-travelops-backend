FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=sunrise-backend-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS production-dependencies
RUN pnpm prune --prod

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json eslint.config.mjs .prettierrc ./
COPY src ./src
COPY test ./test
COPY scripts/check-migration-names.mjs ./scripts/check-migration-names.mjs
RUN pnpm verify:release

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=production-dependencies --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
EXPOSE 4000
CMD ["node", "dist/main.js"]
