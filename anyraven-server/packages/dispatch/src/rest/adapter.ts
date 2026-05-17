import { Router } from "express";

export interface AdapterConfigRouterDeps {
  manager: {
    reloadConfig(config: unknown): Promise<void>;
    adapter: { healthCheck(): Promise<{ ok: boolean; detail?: string | undefined }> };
  };
}

export function adapterConfigRouter(deps: AdapterConfigRouterDeps): Router {
  const r = Router();

  r.put("/config", async (req, res, next) => {
    try {
      await deps.manager.reloadConfig(req.body);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get("/health", async (_req, res, next) => {
    try {
      const health = await deps.manager.adapter.healthCheck();
      res.json(health);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
