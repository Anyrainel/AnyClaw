import { Router } from "express";
import { z } from "zod";
import type { PocketBaseLike } from "../persistence/tasks-repo.js";

const RegisterBody = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

export interface DevicesRouterDeps {
  pb: PocketBaseLike;
}

export function devicesRouter(deps: DevicesRouterDeps): Router {
  const r = Router();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const col = () => deps.pb.collection("_devices") as any;

  r.post("/register", async (req, res, next) => {
    try {
      const parsed = RegisterBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
        return;
      }
      const { expoPushToken, platform } = parsed.data;
      const userToken = (req as unknown as { userToken: string }).userToken;

      // Upsert by expoPushToken
      try {
        const existing = await col().getFirstListItem(
          `expoPushToken = "${expoPushToken}"`,
        );
        const updated = await col().update(existing.id, { platform, userToken });
        res.json(updated);
      } catch {
        const created = await col().create({ expoPushToken, platform, userToken });
        res.json(created);
      }
    } catch (e) {
      next(e);
    }
  });

  return r;
}
