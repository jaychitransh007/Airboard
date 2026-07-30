FROM node:22-bookworm-slim AS builder

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
# The automated-command contract intentionally scans every shipped runtime
# surface for a second gesture inference path. These sources are verification
# inputs only; they never enter the final web runtime image.
COPY apps/api/src apps/api/src
COPY apps/desktop/src apps/desktop/src
COPY extensions/chrome-meet-bridge extensions/chrome-meet-bridge
COPY scripts/generate-help-content.mjs scripts/generate-help-content.mjs
COPY scripts/verify-camera-layer-contract.mjs scripts/verify-camera-layer-contract.mjs
COPY scripts/verify-automated-command-contract.mjs scripts/verify-automated-command-contract.mjs

ARG NEXT_PUBLIC_AIRBOARD_API_URL
ARG NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_CHROME_WEB_STORE_URL
ARG NEXT_PUBLIC_CHROME_EXTENSION_VERSION
ENV NEXT_PUBLIC_AIRBOARD_API_URL=$NEXT_PUBLIC_AIRBOARD_API_URL
ENV NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER=$NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_CHROME_WEB_STORE_URL=$NEXT_PUBLIC_CHROME_WEB_STORE_URL
ENV NEXT_PUBLIC_CHROME_EXTENSION_VERSION=$NEXT_PUBLIC_CHROME_EXTENSION_VERSION
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
