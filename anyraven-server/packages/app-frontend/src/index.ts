import express, { type Express } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PLACEHOLDER_HTML } from "./placeholder.js";

export interface AppFrontendOptions {
  buildDir: string;
}

export function createAppFrontendApp(opts: AppFrontendOptions): Express {
  const app = express();

  const hasIndex = () =>
    existsSync(opts.buildDir) &&
    readdirSync(opts.buildDir).includes("index.html");

  app.use((_req, res, next) => {
    if (hasIndex()) return next();
    res.status(200).type("html").send(PLACEHOLDER_HTML);
  });

  app.use(express.static(opts.buildDir, { index: "index.html" }));

  // SPA fallback
  app.use((_req, res, next) => {
    if (!hasIndex()) return next();
    res.sendFile(path.join(opts.buildDir, "index.html"));
  });

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const buildDir = process.env.APP_FRONTEND_DIR ?? "/data/prod/app-frontend";
  const port = Number(process.env.PORT ?? 5173);
  const app = createAppFrontendApp({ buildDir });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[app-frontend] serving ${buildDir} on :${port}`);
  });
}
