# One image for all process roles (ADR-0012): api | worker | media | migrate.
FROM node:25-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# pnpm at the version pinned in package.json. Not via corepack: Node 25+ no longer bundles it.
RUN npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")"
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @rabit/server...
COPY apps/server apps/server
RUN pnpm --filter @rabit/server build && pnpm --filter @rabit/server deploy --prod --legacy /out

FROM node:25-bookworm-slim
# ffmpeg is required by the worker (ADR-0007). Runs as a non-root user.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini \
  && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 rabit
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
# Amazon RDS certificate authorities, so DATABASE_URL can use sslmode=verify-full
# with sslrootcert=/etc/ssl/rds/global-bundle.pem (ADR-0012).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds/global-bundle.pem
USER rabit
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "-c", "exec node dist/entry/${0}.js \"$@\""]
CMD ["api"]
