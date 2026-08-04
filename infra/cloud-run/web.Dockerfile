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
ARG NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID
ARG NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS
ENV NEXT_PUBLIC_AIRBOARD_API_URL=$NEXT_PUBLIC_AIRBOARD_API_URL
ENV NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER=$NEXT_PUBLIC_GOOGLE_MEET_CLOUD_PROJECT_NUMBER
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_CHROME_WEB_STORE_URL=$NEXT_PUBLIC_CHROME_WEB_STORE_URL
ENV NEXT_PUBLIC_CHROME_EXTENSION_VERSION=$NEXT_PUBLIC_CHROME_EXTENSION_VERSION
ENV NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID=$NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID
ENV NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS=$NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS
ENV NODE_ENV=production
RUN node -e "const id=process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID||''; if(!/^[a-p]{32}$/.test(id)) throw new Error('NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID must be the reviewed 32-character Web Store ID'); const current=process.env.NEXT_PUBLIC_CHROME_EXTENSION_VERSION||''; const values=(process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_COMPATIBLE_VERSIONS||current).split(',').map(value=>value.trim()); const compatible=[...new Set(values)]; if(compatible.length>8||values.some(value=>!/^\\d+\\.\\d+\\.\\d+$/.test(value))||!compatible.includes(current)) throw new Error('Chrome compatible versions must contain at most 8 semantic versions and include the current version');"
RUN node -e "const value=(process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL||'').trim(); if(value){ const id=process.env.NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID||''; let url; try{url=new URL(value)}catch{throw new Error('NEXT_PUBLIC_CHROME_WEB_STORE_URL must be a valid URL')} const parts=url.pathname.split('/').filter(Boolean); const listed=parts.at(-1)||''; if(url.origin!=='https://chromewebstore.google.com'||url.username||url.password||parts[0]!=='detail'||(parts.length!==2&&parts.length!==3)||!/^([a-p]{32})$/.test(listed)||listed!==id) throw new Error('NEXT_PUBLIC_CHROME_WEB_STORE_URL must be the detail page for NEXT_PUBLIC_AIRBOARD_CHROME_EXTENSION_ID'); }"
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
