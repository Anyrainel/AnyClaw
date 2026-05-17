# @anyraven/app-backend

Supervises the agent-built app backend. Watches `/data/prod/app-backend/` and runs `index.js` from that directory on port `3000`. If no build exists, serves a 503 placeholder instead. Designed to be restarted by `supervisord` (`restart=on-failure`) — a deliberate stop during deploy is not treated as a failure.

## Behavior

- On startup: check if `/data/prod/app-backend/index.js` exists.
  - If yes: spawn it as a child process.
  - If no: start the fallback 503 server.
- On file change in the build dir: kill the running process and respawn.
- On child crash: restart immediately (up to a limit), then fall back to the 503 server.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_BACKEND_DIR` | `/data/prod/app-backend` | Directory to watch and run |
| `PORT` | `3000` | Port the app backend listens on |
| `ANYRAVEN_DATA_ROOT` | `/data` | Base path (used for fallback page) |

## Build & Run

```bash
npm run build          # tsc -b
npm start              # node dist/index.js
npm test               # vitest run
```

## Dependencies

- `@anyraven/shared` — `AnyRavenPaths`
- `chokidar` — filesystem watcher
- `express` — fallback 503 server only
