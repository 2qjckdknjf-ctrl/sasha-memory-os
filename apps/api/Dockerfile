# Minimal API image for hosted cron / fly / cloud run
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages ./packages
COPY connectors ./connectors

RUN pnpm install --frozen-lockfile --filter @memory-os/api...

COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
