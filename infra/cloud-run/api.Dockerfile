# Base images are pinned by digest (Dependabot proposes updates). Cloud Run
# ignores Docker HEALTHCHECK; release.sh sets its startup and liveness probes.
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --filter @airboard/api...

COPY apps/api apps/api
COPY packages/core packages/core
RUN pnpm --filter @airboard/api build
# The bundle leaves only fastify, ws, sharp and a few others external, so the
# runtime gets the production dependencies alone, without build tools.
RUN pnpm --filter @airboard/api deploy --prod --legacy /deploy

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app

COPY --from=builder /deploy/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist

USER node
CMD ["node", "apps/api/dist/index.mjs"]

