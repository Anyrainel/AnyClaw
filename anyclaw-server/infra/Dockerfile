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
RUN groupadd --system anyclaw-infra \
 && useradd  --system --gid anyclaw-infra --home /anyclaw --shell /usr/sbin/nologin anyclaw-infra \
 && groupadd --system anyclaw-agent \
 && useradd  --system --gid anyclaw-agent --home /data/dev --shell /bin/bash anyclaw-agent

# Bundle all supervised packages + shared (runtime artifacts only)
RUN mkdir -p /anyclaw/dispatch /anyclaw/shared /anyclaw/tunnel-manager \
             /anyclaw/logic-runner /anyclaw/prod-static /anyclaw/frontend-template \
             /anyclaw/mcp-server
COPY --from=builder /build/packages/dispatch/dist             /anyclaw/dispatch/dist
COPY --from=builder /build/packages/dispatch/package.json     /anyclaw/dispatch/package.json
COPY --from=builder /build/packages/shared/dist               /anyclaw/shared/dist
COPY --from=builder /build/packages/shared/package.json       /anyclaw/shared/package.json
COPY --from=builder /build/packages/shared/node_modules       /anyclaw/shared/node_modules
COPY --from=builder /build/packages/mcp-server/dist           /anyclaw/mcp-server/dist
COPY --from=builder /build/packages/mcp-server/package.json   /anyclaw/mcp-server/package.json
COPY --from=builder /build/packages/tunnel-manager/dist       /anyclaw/tunnel-manager/dist
COPY --from=builder /build/packages/tunnel-manager/package.json /anyclaw/tunnel-manager/package.json
COPY --from=builder /build/packages/logic-runner/dist         /anyclaw/logic-runner/dist
COPY --from=builder /build/packages/logic-runner/package.json /anyclaw/logic-runner/package.json
COPY --from=builder /build/packages/prod-static/dist          /anyclaw/prod-static/dist
COPY --from=builder /build/packages/prod-static/package.json  /anyclaw/prod-static/package.json
# frontend-template is copied as SOURCE (not built dist) because init-data-layout.sh
# seeds the source into /data/dev/ on first run where the agent will modify and build it.
COPY --from=builder /build/packages/frontend-template         /anyclaw/frontend-template
COPY --from=builder /build/node_modules                       /anyclaw/node_modules
RUN rm -rf /anyclaw/frontend-template/node_modules /anyclaw/frontend-template/dist \
 && chown -R anyclaw-infra:anyclaw-infra /anyclaw
# Fix workspace symlinks — they point to ../../packages/* from builder stage
RUN for pkg in dispatch shared mcp-server tunnel-manager logic-runner prod-static frontend-template direct-connect wireguard; do \
      rm -f /anyclaw/node_modules/@anyclaw/$pkg \
      && ln -s /anyclaw/$pkg /anyclaw/node_modules/@anyclaw/$pkg; \
    done

# Data directories
RUN mkdir -p /data/pocketbase/pb_data \
             /data/dev/.worktrees \
             /data/prod/frontend-build \
             /data/prod/logic-build \
             /data/snapshots \
             /data/.anyclaw/logs \
             /var/log/anyclaw \
             /var/run \
 && chown -R anyclaw-infra:anyclaw-infra /data/pocketbase /data/prod /data/snapshots \
                                          /data/.anyclaw  /var/log/anyclaw \
 && chown -R anyclaw-agent:anyclaw-agent /data/dev \
 && chmod 0750 /data/.anyclaw

# Infra scripts + supervisord config
COPY infra/scripts/ /anyclaw/scripts/
RUN chmod +x /anyclaw/scripts/*.sh
COPY infra/supervisord.conf /etc/supervisor/conf.d/anyclaw.conf

# Skills bundle (Plan 6)
COPY skills/raw/ /.anyclaw/skills/raw/
COPY scripts/package-skills.sh /.anyclaw/scripts/package-skills.sh
RUN chmod +x /.anyclaw/scripts/package-skills.sh \
 && bash /.anyclaw/scripts/package-skills.sh generic \
      --source /.anyclaw/skills/raw \
      --out /.anyclaw/skills/system-prompt.txt

# Initialize the dev git repo at image-build time so the container is ready
RUN bash /anyclaw/scripts/init-data-layout.sh \
 && chown -R anyclaw-agent:anyclaw-agent /data/dev

EXPOSE 8090 4100 5173 3000
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/bin/bash", "-lc", "/anyclaw/scripts/init-data-layout.sh && exec /usr/bin/supervisord -c /etc/supervisor/conf.d/anyclaw.conf"]
