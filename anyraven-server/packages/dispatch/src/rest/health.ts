import { Router } from "express";

export interface HealthRouterDeps {
  version: string;
  startedAt: number;
  adapter: { healthCheck(): Promise<{ ok: boolean; detail?: string | undefined }> };
}

export function healthRouter(deps: HealthRouterDeps): Router {
  const r = Router();

  r.get("/", async (_req, res, next) => {
    try {
      const adapterHealth = await deps.adapter.healthCheck();
      const uptimeMs = Date.now() - deps.startedAt;
      res.json({
        ok: adapterHealth.ok,
        version: deps.version,
        uptimeMs,
        adapter: adapterHealth,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
