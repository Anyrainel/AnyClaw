# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim AS builder

WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json vitest.config.ts ./
COPY packages ./packages
RUN npm ci
RUN npm run build


FROM node:20-bookworm-slim

ARG POCKETBASE_VERSION=0.25.0

RUN apt-get update && apt-get install -y --no-install-recommends \
      supervisor \
      git \
      curl \
      ca-certificates \
      unzip \
      tini \
 && rm -rf /var/lib/apt/lists/*

# PocketBase binary
RUN curl -fsSL -o /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
 && unzip /tmp/pb.zip -d /usr/local/bin \
 && rm /tmp/pb.zip \
 && chmod +x /usr/local/bin/pocketbase

# Non-root users
RUN groupadd --system anyraven-infra \
 && useradd  --system --gid anyraven-infra --home /anyraven --shell /usr/sbin/nologin anyraven-infra \
 && groupadd --system anyraven-agent \
 && useradd  --system --gid anyraven-agent --home /data/dev --shell /bin/bash anyraven-agent

# Bundle all supervised packages + shared (runtime artifacts only)
RUN mkdir -p /anyraven/dispatch /anyraven/shared /anyraven/tunnel-manager \
             /anyraven/app-backend /anyraven/app-frontend /anyraven/frontend-template \
             /anyraven/mcp-server
COPY --from=builder /build/packages/dispatch/dist             /anyraven/dispatch/dist
COPY --from=builder /build/packages/dispatch/package.json     /anyraven/dispatch/package.json
COPY --from=builder /build/packages/shared/dist               /anyraven/shared/dist
COPY --from=builder /build/packages/shared/package.json       /anyraven/shared/package.json
COPY --from=builder /build/packages/shared/node_modules       /anyraven/shared/node_modules
COPY --from=builder /build/packages/mcp-server/dist           /anyraven/mcp-server/dist
COPY --from=builder /build/packages/mcp-server/package.json   /anyraven/mcp-server/package.json
COPY --from=builder /build/packages/tunnel-manager/dist       /anyraven/tunnel-manager/dist
COPY --from=builder /build/packages/tunnel-manager/package.json /anyraven/tunnel-manager/package.json
COPY --from=builder /build/packages/app-backend/dist         /anyraven/app-backend/dist
COPY --from=builder /build/packages/app-backend/package.json /anyraven/app-backend/package.json
COPY --from=builder /build/packages/app-frontend/dist          /anyraven/app-frontend/dist
COPY --from=builder /build/packages/app-frontend/package.json  /anyraven/app-frontend/package.json
# frontend-template is copied as SOURCE (not built dist) because init-data-layout.sh
# seeds the source into /data/dev/ on first run where the agent will modify and build it.
COPY --from=builder /build/packages/frontend-template         /anyraven/frontend-template
COPY --from=builder /build/node_modules                       /anyraven/node_modules
RUN rm -rf /anyraven/frontend-template/dist \
 && chown -R anyraven-infra:anyraven-infra /anyraven
# Fix workspace symlinks — they point to ../../packages/* from builder stage
RUN for pkg in dispatch shared mcp-server tunnel-manager app-backend app-frontend frontend-template direct-connect wireguard; do \
      rm -f /anyraven/node_modules/@anyraven/$pkg \
      && ln -s /anyraven/$pkg /anyraven/node_modules/@anyraven/$pkg; \
    done

# Data directories
RUN mkdir -p /data/pocketbase/pb_data \
             /data/dev/.worktrees \
             /data/prod/app-frontend \
             /data/prod/app-backend \
             /data/snapshots \
             /data/.anyraven/logs \
             /var/log/anyraven \
             /var/run \
 && chown -R anyraven-infra:anyraven-infra /data/pocketbase /data/prod /data/snapshots \
                                          /data/.anyraven  /var/log/anyraven \
 && chown -R anyraven-infra:anyraven-infra /data/dev \
 && chmod 0750 /data/.anyraven

# Infra scripts + supervisord config
COPY infra/scripts/ /anyraven/scripts/
RUN chmod +x /anyraven/scripts/*.sh
COPY infra/supervisord.conf /etc/supervisor/conf.d/anyraven.conf

# Skills bundle (Plan 6)
COPY skills/raw/ /.anyraven/skills/raw/
COPY scripts/package-skills.sh /.anyraven/scripts/package-skills.sh
COPY scripts/seed-welcome-collection.js /.anyraven/scripts/seed-welcome-collection.js
RUN chmod +x /.anyraven/scripts/package-skills.sh \
 && bash /.anyraven/scripts/package-skills.sh generic \
      --source /.anyraven/skills/raw \
      --out /.anyraven/skills/system-prompt.txt

# Initialize the dev git repo at image-build time so the container is ready
RUN bash /anyraven/scripts/init-data-layout.sh \
 && chown -R anyraven-infra:anyraven-infra /data/dev

EXPOSE 8090 4100 5173 3000
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/bin/bash", "-lc", "/anyraven/scripts/init-data-layout.sh && exec /usr/bin/supervisord -c /etc/supervisor/conf.d/anyraven.conf"]
