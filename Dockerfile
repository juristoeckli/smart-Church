FROM node:24-bookworm-slim AS build
ARG SMART_CHURCH_VERSION=
ARG SMART_CHURCH_BUILD_NUMBER=
ENV VITE_SMART_CHURCH_VERSION=${SMART_CHURCH_VERSION}
ENV VITE_SMART_CHURCH_BUILD_NUMBER=${SMART_CHURCH_BUILD_NUMBER}
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @smart-church/web build

FROM build AS dev
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates iputils-ping \
  && rm -rf /var/lib/apt/lists/*
ENV PYTHON_BINARY=python3

FROM build AS api-build
RUN cp -a /workspace/apps/api/src /workspace/apps/api/src-core \
  && rm -rf /workspace/apps/api/src-core/modules/amx

FROM build AS web-amx-build
ENV SMART_CHURCH_INCLUDE_AMX=1
RUN pnpm --filter @smart-church/web build

FROM node:24-bookworm-slim AS api
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates iputils-ping \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --prod --frozen-lockfile
RUN cd /workspace/apps/api && node --import tsx --input-type=module -e "await import('tsx')"
COPY --from=api-build --chown=node:node /workspace/apps/api/src-core /workspace/apps/api/src
COPY --from=build --chown=node:node /workspace/apps/api/migrations /workspace/apps/api/migrations
COPY --from=build --chown=node:node /workspace/apps/web/dist /workspace/apps/api/web-dist
COPY --from=build --chown=node:node /workspace/packages/contracts/src /workspace/packages/contracts/src
RUN mkdir -p /workspace/apps/api/data /var/lib/smart-church && chown -R node:node /workspace/apps/api/data /var/lib/smart-church
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
ENV PRESENTER_MEDIA_DIR=/var/lib/smart-church/presenter-media
ENV SMART_CHURCH_MODULES_DIR=/var/lib/smart-church/modules
USER node
EXPOSE 3001
WORKDIR /workspace/apps/api
CMD ["node", "--import", "tsx", "src/server.ts"]

FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/dist /app/dist
COPY --from=build --chown=node:node /workspace/apps/web/serve.mjs /app/serve.mjs
ENV HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "serve.mjs"]

FROM node:24-bookworm-slim AS web-amx
WORKDIR /app
COPY --from=web-amx-build --chown=node:node /workspace/apps/web/dist /app/dist
COPY --from=web-amx-build --chown=node:node /workspace/apps/web/serve.mjs /app/serve.mjs
ENV HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "serve.mjs"]

FROM alpine:3.22 AS module-amx
COPY apps/api/src/modules/amx /opt/smart-church/module/amx
CMD ["sh", "-c", "mkdir -p /modules/amx && cp -R /opt/smart-church/module/amx/. /modules/amx/"]
