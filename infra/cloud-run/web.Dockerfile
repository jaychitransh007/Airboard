# Base images are pinned by digest (Dependabot proposes updates). Cloud Run
# ignores Docker HEALTHCHECK; release.sh sets its startup and liveness probes.
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY README.md README.md
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @airboard/web...

COPY apps/web apps/web
COPY Docs Docs
# The help generator checks that every source path a help article cites
# exists, and some cite API files. These sources are build inputs only; they
# never enter the final web runtime image.
COPY apps/api/src apps/api/src
COPY scripts/generate-help-content.mjs scripts/generate-help-content.mjs

ARG NEXT_PUBLIC_AIRBOARD_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_AIRBOARD_API_URL=$NEXT_PUBLIC_AIRBOARD_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NODE_ENV=production
RUN pnpm --filter @airboard/web build

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=builder /app/apps/web/.next-production/standalone ./
COPY --from=builder /app/apps/web/.next-production/static ./apps/web/.next-production/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER node
CMD ["node", "apps/web/server.js"]
