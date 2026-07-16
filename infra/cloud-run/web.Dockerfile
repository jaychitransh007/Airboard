FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @airboard/web...

COPY apps/web apps/web

ARG NEXT_PUBLIC_AIRBOARD_API_URL
ARG NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER
ENV NEXT_PUBLIC_AIRBOARD_API_URL=$NEXT_PUBLIC_AIRBOARD_API_URL
ENV NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER=$NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER
ENV NODE_ENV=production
RUN pnpm --filter @airboard/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=builder /app/apps/web/.next-production/standalone ./
COPY --from=builder /app/apps/web/.next-production/static ./apps/web/.next-production/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER node
CMD ["node", "apps/web/server.js"]

