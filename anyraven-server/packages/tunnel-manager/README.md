# @anyraven/tunnel-manager

Persistent WebSocket client that maintains a tunnel from the anyraven-server to either:
1. **The broker** — relayed connection through AnyRaven's cloud broker (auth + encrypted frame relay)
2. **A user-provided tunnel** — direct connection via Cloudflare Tunnel, ngrok, or any other WSS endpoint the user configures

The tunnel manager routes inbound frames to the correct local service based on the service label in the envelope.

See [docs/plan4-connection-broker-design.md](../../../docs/plan4-connection-broker-design.md) for architecture details.

## Responsibilities

- Connect to the broker's server WebSocket endpoint (broker mode) or a user-provided tunnel URL (direct mode).
- Maintain the connection with exponential-backoff reconnection on disconnect.
- Route inbound frames to the correct local service based on the service label in the envelope.
- Re-encrypt or forward frames as appropriate.

## Connection Modes

### Broker Mode (default)
Connects to `wss://broker.anyraven.com/relay/server` using the server's auth token. The broker relays encrypted frames between the mobile app and the server.

### Direct Mode
Connects directly to a user-provided WSS URL (e.g. `wss://my-server.ngrok.io` or `wss://my-tunnel.cloudflare.com`). No broker involvement. The mobile app connects to the same endpoint.

Use direct mode when:
- You already have a tunnel solution (Cloudflare Tunnel, ngrok, etc.)
- You want to avoid broker bandwidth limits
- You prefer self-managed connectivity

## Service Routing

| Envelope label | Local target |
|---|---|
| `pb` | `http://127.0.0.1:8090` (PocketBase) |
| `api` | `http://127.0.0.1:4100` (dispatch) |
| `app` | `http://127.0.0.1:5173` (app-frontend) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANYRAVEN_DATA_ROOT` | `/data` | Locates secrets dir for server token and device keys |
| `BROKER_URL` | `wss://broker.anyraven.com` | WSS URL of the broker (broker mode only) |
| `ANYRAVEN_TUNNEL_URL` | — | User-provided WSS URL for direct mode. If set, takes precedence over broker mode. |

## Build & Run

```bash
npm run build          # tsc -b
npm start              # node dist/index.js
npm test               # vitest run
```

## Dependencies

- `@anyraven/shared` — `AnyRavenPaths`, crypto
- `ws` — WebSocket client
