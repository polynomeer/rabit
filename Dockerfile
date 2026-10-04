# One image for all process roles (ADR-0012): api | worker | media | migrate.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @rabit/server...
COPY apps/server apps/server
RUN pnpm --filter @rabit/server build && pnpm --filter @rabit/server deploy --prod --legacy /out

FROM node:24-bookworm-slim
# ffmpeg is required by the worker (ADR-0007). Runs as a non-root user.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini \
  && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 rabit
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
USER rabit
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "-c", "exec node dist/entry/${0}.js \"$@\""]
CMD ["api"]
