import { Router } from "express";

export interface VersionRouterDeps {
  serverVersion: string;
  minSkillVersion: string;
}

export function versionRouter(deps: VersionRouterDeps): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    res.json({
      server_version: deps.serverVersion,
      min_skill_version: deps.minSkillVersion,
    });
  });

  return r;
}
