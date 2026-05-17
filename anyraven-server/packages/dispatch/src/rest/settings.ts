import { Router } from "express";
import type { PocketBaseLike } from "../persistence/tasks-repo.js";

const ALLOWED_KEYS = new Set([
  "clarificationTimeoutMode",
  "clarificationTimeoutMs",
  "maxBudgetUsd",
  "adapterType",
]);

export interface SettingsRouterDeps {
  pb: PocketBaseLike;
}

export function settingsRouter(deps: SettingsRouterDeps): Router {
  const r = Router();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const col = () => deps.pb.collection("_user_preferences") as any;

  r.get("/", async (_req, res, next) => {
    try {
      const rows = (await col().getFullList()) as Array<{ key: string; value: unknown }>;
      const map: Record<string, unknown> = {};
      for (const row of rows) {
        map[row.key] = row.value;
      }
      res.json(map);
    } catch (e) {
      next(e);
    }
  });

  r.patch("/", async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const keys = Object.keys(body);
      if (keys.length === 0) {
        res.status(400).json({ error: "bad_request", message: "empty body" });
        return;
      }
      for (const key of keys) {
        if (!ALLOWED_KEYS.has(key)) {
          res.status(400).json({ error: "bad_request", message: `unknown key: ${key}` });
          return;
        }
      }

      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const value = body[key];
        try {
          const existing = await col().getFirstListItem(`key = "${key}"`);
          await col().update(existing.id, { value });
        } catch {
          await col().create({ key, value });
        }
        result[key] = value;
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
