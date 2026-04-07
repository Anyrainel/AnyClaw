import express, { type Express } from "express";

export interface AppOptions {
  version: string;
}

/**
 * createApp() returns the single Express instance that hosts ALL dispatch
 * routes. Plan 1 wires only `/health`. Plan 2 mounts MCP routes onto this
 * same app (via `app.use("/mcp", mcpRouter)`). Plan 3 mounts REST routes
 * and agent adapters (via `app.use("/api", restRouter)` etc.). There is
 * only ever ONE Express app per container, listening on port 4100.
 */
export function createApp(opts: AppOptions): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", version: opts.version });
  });

  return app;
}

// Entrypoint for `node dist/index.js`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 4100);
  const app = createApp({ version: process.env.ANYCLAW_VERSION ?? "0.1.0" });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[dispatch] listening on :${port}`);
  });
}
