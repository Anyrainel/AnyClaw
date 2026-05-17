import { Router } from "express";

export interface EmergencyRouterDeps {
  rollbackManager: { rollback(): Promise<void> };
  deployManager: { promote(): Promise<void> };
  restartFn: () => Promise<void>;
  versionStore: { list(): Promise<unknown[]> };
}

export function emergencyRouter(deps: EmergencyRouterDeps): Router {
  const r = Router();

  r.post("/rollback", async (_req, res, next) => {
    try {
      await deps.rollbackManager.rollback();
      await deps.deployManager.promote();
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.post("/restart-app", async (_req, res, next) => {
    try {
      await deps.restartFn();
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get("/versions", async (_req, res, next) => {
    try {
      const versions = await deps.versionStore.list();
      res.json(versions);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
