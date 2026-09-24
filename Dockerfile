# PetMate production image.
#
# Multi-stage so the runtime image carries the built app and nothing else: no
# source, no dev dependencies, no package manager cache. Next's standalone
# output means the final stage does not even need node_modules.

# --- Stage 1: dependencies --------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma's engines need this on Alpine.
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json* ./
# `npm ci` fails loudly when the lockfile and package.json disagree, which is
# what you want in a build — `npm install` would quietly resolve something else.
RUN npm ci

# --- Stage 2: build ---------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The Postgres schema is generated from the portable one, then the client is
# generated against it, so the image never ships a SQLite-shaped client.
RUN npm run pg:schema \
 && npx prisma generate --schema prisma/schema.postgres.prisma

# Build-time public variables are inlined into the client bundle, so they must
# be present here rather than only at runtime.
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ARG NEXT_PUBLIC_APP_NAME="PetMate"
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_TELEMETRY_DISABLED=1

# A placeholder so the build can evaluate the schema; the real value is
# injected at runtime and nothing in the build connects to a database.
ENV PETMATE_DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN npm run build

# --- Stage 3: runtime -------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Uploads written by the local storage driver. Mount a volume here, or use S3 —
# a container filesystem does not survive a redeploy.
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads

USER nextjs
EXPOSE 3000

# The health endpoint checks the database and the job queue, not just that the
# process is alive, so an unhealthy container is actually restarted.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# --- Stage 4: worker --------------------------------------------------------
# The worker is not a Next.js server, so standalone tracing does not cover it.
# It needs the real node_modules and a TypeScript loader that understands the
# `@/` path alias, which is why this stage is separate rather than sharing the
# runtime image above.
FROM node:22-alpine AS worker
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts  && npm install --no-save tsx@^4

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN addgroup --system --gid 1001 nodejs  && adduser --system --uid 1001 worker  && chown -R worker:nodejs /app

USER worker

# `--conditions=react-server` because the services the handlers import are
# marked `server-only`, which throws under any other condition.
CMD ["npx", "tsx", "--conditions=react-server", "src/worker/main.ts"]
