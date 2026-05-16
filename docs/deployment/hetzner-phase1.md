# Hetzner Single-VPS Deployment Guide (Phase 1)

AnyRaven Phase 1 deployment: a single Hetzner CX32 VPS hosting the broker
process, Caddy for TLS termination, and per-user containers.

## VPS Specification

| Resource | Value |
|----------|-------|
| Plan | Hetzner CX32 |
| vCPU | 4 |
| RAM | 8 GB |
| Disk | 80 GB NVMe |
| Region | Ashburn (us-east) |
| OS | Ubuntu 24.04 LTS |

## Initial Server Setup

```bash
# SSH into the new VPS
ssh root@<your-vps-ip>

# Update and install essentials
apt update && apt upgrade -y
apt install -y curl ufw fail2ban

# Create a non-root user
adduser anyclaw
usermod -aG sudo anyclaw

# Switch to the new user for remaining steps
su - anyclaw
```

## Firewall Configuration

Only port 443 (Caddy TLS) is exposed publicly. All user container traffic
flows through the tunnel manager (WSS via Caddy).

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 443/tcp       # Caddy (HTTPS + WSS)
sudo ufw enable
```

No other ports are opened. PocketBase (8090), the dispatch server (4100),
and inter-container communication stay on localhost or Docker networks only.

## Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker anyclaw
newgrp docker

# Verify
docker --version
docker compose version
```

## Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## DNS Configuration

Create the following DNS records for `anyraven.com` (or your domain):

| Type | Name | Value |
|------|------|-------|
| A | broker.anyraven.com | `<vps-ip>` |
| A | anyraven.com | `<vps-ip>` |

Caddy handles TLS certificate provisioning automatically via Let's Encrypt.

## Directory Layout

```bash
sudo mkdir -p /opt/anyclaw/{provisioner,caddy,users}
sudo chown -R anyclaw:anyclaw /opt/anyclaw
```

```
/opt/anyclaw/
  provisioner/
    docker-compose.yml      # Broker + provisioner services
  caddy/
    Caddyfile               # TLS termination + reverse proxy
  users/
    user-<id>/
      docker-compose.yml    # Per-user container (templated)
      data/                 # Bind-mounted /data volume
```

## Caddyfile

```bash
cat > /opt/anyclaw/caddy/Caddyfile << 'CADDYEOF'
broker.anyraven.com {
    reverse_proxy localhost:8443
    encode gzip
}
CADDYEOF

# Reload Caddy
sudo cp /opt/anyclaw/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy terminates TLS on `broker.anyraven.com` and reverse-proxies WSS
connections to the broker process on port 8443.

## Provisioner Compose

The provisioner runs the broker (accepts WSS from mobile apps) and manages
user container lifecycle.

```bash
cat > /opt/anyclaw/provisioner/docker-compose.yml << 'EOF'
version: "3.8"

services:
  broker:
    image: ghcr.io/anyclaw/anyclaw-broker:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8443:8443"
    volumes:
      - /opt/anyclaw/users:/opt/anyclaw/users:ro
    environment:
      - BROKER_PORT=8443
      - USER_DATA_ROOT=/opt/anyclaw/users
EOF
```

```bash
cd /opt/anyclaw/provisioner
docker compose up -d
```

## Per-User Container Template

Each user gets an isolated container with its own PocketBase data and no
host port bindings (all ingress via tunnel).

```bash
# Template: replace <USER_ID> and <USER_TOKEN> at provisioning time
cat > /opt/anyclaw/users/user-template.yml << 'EOF'
version: "3.8"

services:
  anyclaw:
    image: ghcr.io/anyclaw/anyclaw:latest
    container_name: anyclaw-user-USER_ID
    restart: unless-stopped
    volumes:
      - ./data:/data
    environment:
      - ANYCLAW_USER_TOKEN=USER_TOKEN
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
    # No port bindings — all traffic via tunnel manager
EOF
```

### Provisioning a New User

```bash
USER_ID="abc123"
USER_TOKEN="$(openssl rand -hex 32)"
USER_DIR="/opt/anyclaw/users/user-$USER_ID"

mkdir -p "$USER_DIR/data"
sed "s/USER_ID/$USER_ID/g; s/USER_TOKEN/$USER_TOKEN/g" \
  /opt/anyclaw/users/user-template.yml > "$USER_DIR/docker-compose.yml"

cd "$USER_DIR"
docker compose up -d
```

### Resource Limits

Each user container is capped at:
- **CPU:** 0.5 cores
- **Memory:** 512 MB

These can be adjusted per-user in their `docker-compose.yml`.

### Idle Shutdown

Containers are stopped after 30 minutes of tunnel inactivity to conserve
resources. The broker wakes them on the next incoming message.

```bash
# Example cron job (runs every 5 minutes)
# /opt/anyclaw/provisioner/idle-check.sh
*/5 * * * * /opt/anyclaw/provisioner/idle-check.sh
```

The idle-check script inspects the last tunnel activity timestamp for each
user and runs `docker compose stop` for idle containers.

## Backup

Nightly backup of all user PocketBase data to offsite storage:

```bash
cat > /opt/anyclaw/provisioner/backup.sh << 'BACKUPEOF'
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/anyclaw/backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

for user_dir in /opt/anyclaw/users/user-*/; do
  user_id=$(basename "$user_dir")
  pb_data="$user_dir/data/pocketbase/pb_data"
  if [ -d "$pb_data" ]; then
    tar czf "$BACKUP_DIR/$user_id.tar.gz" -C "$user_dir/data/pocketbase" pb_data
  fi
done

# Upload to offsite (configure your provider)
# rclone copy "$BACKUP_DIR" remote:anyclaw-backups/
echo "Backup complete: $BACKUP_DIR"
BACKUPEOF
chmod +x /opt/anyclaw/provisioner/backup.sh
```

```bash
# Add to crontab: daily at 3 AM
echo "0 3 * * * /opt/anyclaw/provisioner/backup.sh" | crontab -
```

## Monitoring

Basic monitoring via Docker stats and container count:

```bash
# Real-time resource usage
docker stats --no-stream

# Count running user containers
docker ps --filter "name=anyclaw-user-" --format "{{.Names}}" | wc -l

# Simple cron alert if too many containers are running
cat > /opt/anyclaw/provisioner/monitor.sh << 'MONEOF'
#!/usr/bin/env bash
COUNT=$(docker ps --filter "name=anyclaw-user-" -q | wc -l)
if [ "$COUNT" -gt 14 ]; then
  echo "WARNING: $COUNT user containers running on CX32 (recommended max: 14)"
fi
MONEOF
chmod +x /opt/anyclaw/provisioner/monitor.sh

# Every 10 minutes
echo "*/10 * * * * /opt/anyclaw/provisioner/monitor.sh" >> /tmp/cron-monitor
crontab -l 2>/dev/null | cat - /tmp/cron-monitor | crontab -
```

## Security Summary

- Only port 443 is publicly accessible (Caddy for TLS).
- SSH on port 22 (consider moving to a non-standard port).
- No user containers have host port bindings.
- Only the tunnel manager makes outbound connections (WSS to broker).
- `ufw` blocks all other inbound traffic.
- PocketBase admin credentials are stored mode 0600 inside each container.
- LLM API keys are encrypted at rest via the dispatch process.

## Migration to Phase 2 (microVMs / K8s Agent Sandbox)

The same `ghcr.io/anyclaw/anyclaw:latest` image used here runs unchanged in
a microVM (Firecracker) or Kubernetes pod. Phase 2 replaces the provisioner
shell scripts with a proper scheduler (K8s operator or Firecracker orchestrator)
while keeping the per-user data volume layout and tunnel-based networking
identical. The migration path is: stop the Docker container, copy
`/opt/anyclaw/users/user-<id>/data/` into the new storage backend, and start
the same image in the new runtime. No user data migration is needed beyond
the volume copy.
