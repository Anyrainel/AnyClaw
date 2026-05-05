# @anyclaw/tunnel-manager

Persistent WebSocket client that maintains a tunnel from the anyclaw-server to the broker. The broker uses this tunnel to relay encrypted frames from the mobile app to the server's local services (PocketBase on `:8090`, dispatch on `:4100`, prod-static on `:5173`).

See [docs/plan4-connection-broker-design.md](../../../docs/plan4-connection-broker-design.md) for architecture details.

## Responsibilities

- Connect to the broker's server WebSocket endpoint with the server's auth token.
- Maintain the connection with exponential-backoff reconnection on disconnect.
- Route inbound frames to the correct local service based on the service label in the envelope.
- Re-encrypt or forward frames as appropriate.

## Service Routing

| Envelope label | Local target |
|---|---|
| `pb` | `http://127.0.0.1:8090` (PocketBase) |
| `api` | `http://127.0.0.1:4100` (dispatch) |
| `app` | `http://127.0.0.1:5173` (prod-static) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANYCLAW_DATA_ROOT` | `/data` | Locates secrets dir for server token and device keys |
| `BROKER_URL` | — | WSS URL of the broker |

## Build & Run

```bash
npm run build          # tsc -b
npm start              # node dist/index.js
npm test               # vitest run
```

## Dependencies

- `@anyclaw/shared` — `AnyClawPaths`, crypto
- `ws` — WebSocket client
