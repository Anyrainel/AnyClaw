import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { versionRouter, type VersionRouterDeps } from "../../src/rest/version.js";

function makeApp(deps: VersionRouterDeps) {
  const app = express();
  app.use(express.json());
  app.use("/api/version", versionRouter(deps));
  return app;
}

describe("GET /api/version", () => {
  it("returns server_version and min_skill_version", async () => {
    const app = makeApp({
      serverVersion: "0.1.0",
      minSkillVersion: "1.0.0",
    });

    const res = await request(app).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      server_version: "0.1.0",
      min_skill_version: "1.0.0",
    });
  });

  it("reflects configured versions", async () => {
    const app = makeApp({
      serverVersion: "2.3.4",
      minSkillVersion: "1.5.0",
    });

    const res = await request(app).get("/api/version");
    expect(res.body.server_version).toBe("2.3.4");
    expect(res.body.min_skill_version).toBe("1.5.0");
  });
});
