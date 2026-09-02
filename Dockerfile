# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# Prisma generate and Next build need a syntactically valid URL, but do not
# connect to the database during image build. Runtime DATABASE_URL is provided
# by the server environment.
ENV DATABASE_URL=postgresql://user:password@localhost:5432/telestar?schema=public

# NEXT_PUBLIC_* is inlined at build time. Compose/CI pass the real public origin as a build arg;
# the default keeps plain local builds working.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
# Give the Next build worker headroom on small hosts (t3.medium 4GB) so it doesn't OOM.
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# prisma.config.ts holds the datasource url (schema.prisma has no url); prisma migrate deploy
# needs it at runtime, so the runner stage must include it — not just the builder.
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/app/generated ./app/generated
# worker/imap run outside Next: v2-runtime-worker.mjs transpiles lib/ TS on the fly
# (loadTsModule), so the runner needs the script entrypoints + the lib/ source tree.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib

EXPOSE 3000

CMD ["npm", "run", "start:production"]
