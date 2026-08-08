ARG NPM_VERSION=11.13.0

FROM node:24-bookworm-slim AS deps

ARG NPM_VERSION

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm install -g npm@${NPM_VERSION} \
  && npm ci

FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time placeholders satisfy fail-fast env validation while keeping real
# secrets in the runtime env file.
ENV DATABASE_URL="postgresql://crm:crm@postgres:5432/telestar_crm" \
  DIRECT_URL="postgresql://crm:crm@postgres:5432/telestar_crm" \
  AUTH_SECRET="build-time-placeholder" \
  ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" \
  NEXTAUTH_URL="http://localhost:3000" \
  NEXT_TELEMETRY_DISABLED=1 \
  NODE_OPTIONS="--max-old-space-size=4096"

RUN npm run build

FROM node:24-bookworm-slim AS runner

ARG NPM_VERSION

# Release provenance, baked into the image so the running container can name the commit it
# was built from. `unknown` is the honest default for a local build: lib/release.ts treats
# it as absent rather than letting an unpublished image claim an identity.
ARG APP_COMMIT=unknown
ARG APP_VERSION=unknown
ARG APP_BUILT_AT=unknown

WORKDIR /app

# Runtime sentinels, NOT usable defaults. Every one of these fails the fail-fast
# check in lib/env.ts, so a deployment that forgets to inject the real secrets
# crashes on boot instead of silently serving with a known placeholder signing
# key. The real values arrive from the platform's secret store at run time.
# NEXTAUTH_URL is deliberately absent — auth.config.ts sets trustHost: true.
ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  DATABASE_URL="postgresql://invalid" \
  DIRECT_URL="postgresql://invalid" \
  AUTH_SECRET="" \
  ENCRYPTION_KEY="REPLACE_AT_RUNTIME" \
  APP_COMMIT=${APP_COMMIT} \
  APP_VERSION=${APP_VERSION} \
  APP_BUILT_AT=${APP_BUILT_AT}

# Mirrored as labels so the provenance is readable with `docker inspect`, without running
# the image. Same values, two audiences: labels for the operator, env for the process.
LABEL org.opencontainers.image.revision="${APP_COMMIT}" \
  org.opencontainers.image.version="${APP_VERSION}" \
  org.opencontainers.image.created="${APP_BUILT_AT}" \
  org.opencontainers.image.source="https://github.com/sonnynguyen170321-ctrl/crm-4-telestar-final"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install -g npm@${NPM_VERSION} \
  && npm ci --omit=dev \
  && npx prisma generate \
  && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY public ./public
COPY app ./app
COPY components ./components
COPY context ./context
COPY hooks ./hooks
COPY lib ./lib
COPY workers ./workers
COPY scripts ./scripts
COPY auth.config.ts auth.ts instrumentation.ts next.config.ts proxy.ts tsconfig.json ./

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]
