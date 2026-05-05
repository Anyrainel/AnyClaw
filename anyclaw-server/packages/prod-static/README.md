# @anyclaw/prod-static

Serves the agent-built frontend SPA from `/data/prod/frontend-build/` on port `5173`. Provides standard SPA fallback (all non-asset paths serve `index.html`) and a placeholder page if the build directory doesn't exist yet.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PROD_FRONTEND_DIR` | `/data/prod/frontend-build` | Directory to serve |
| `PORT` | `5173` | HTTP listen port |

## Build & Run

```bash
npm run build          # tsc -b
npm start              # node dist/index.js
npm test               # vitest run
```

## Dependencies

- `express` — static file serving and SPA fallback only
