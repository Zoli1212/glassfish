# Glassfish Zero — single container, SQLite on a mounted volume.
#
# Node 24 is the floor because the database runs on the built-in `node:sqlite`,
# which needs --experimental-sqlite on 22.5–23.3. No native modules, so there
# is no compiler toolchain in any stage.

# ---------------------------------------------------------------- deps
FROM node:24-alpine AS deps
WORKDIR /repo

# Only the manifests, so a source-only change does not re-run the install.
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/web/package.json apps/web/

RUN npm ci

# --------------------------------------------------------------- build
FROM node:24-alpine AS build
WORKDIR /repo

ENV NEXT_TELEMETRY_DISABLED=1

# The whole installed tree, not a list of per-workspace node_modules: npm
# hoists what it can to the root and leaves a nested install only where
# versions conflict, so which directories exist is not something a Dockerfile
# should hard-code. `apps/web/node_modules` does not exist at all today.
COPY --from=deps /repo ./
COPY . .

# The SDK is compiled too, so the image can serve its tarball and the types
# stay in step with the dashboard's wire format.
RUN npm run build --workspace=glassfish-zero \
 && npm run build --workspace=@glassfish-zero/web

# -------------------------------------------------------------- runtime
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GLASSFISH_DB=/data/glassfish.db

# Run unprivileged; the volume is chowned to the same user.
RUN addgroup -g 1001 -S glassfish \
 && adduser -u 1001 -S glassfish -G glassfish \
 && mkdir -p /data \
 && chown -R glassfish:glassfish /data

# `output: 'standalone'` emits a pruned server bundle; static assets and
# public files are not included in it and must be copied alongside.
COPY --from=build --chown=glassfish:glassfish /repo/apps/web/.next/standalone ./
COPY --from=build --chown=glassfish:glassfish /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=glassfish:glassfish /repo/apps/web/public ./apps/web/public

USER glassfish
EXPOSE 3000
VOLUME ["/data"]

# The platform's own health check can point at the same endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
