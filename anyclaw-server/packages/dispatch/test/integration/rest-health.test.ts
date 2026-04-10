import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { healthRouter, type HealthRouterDeps } from "../../src/rest/health.js";

function buildApp(deps: HealthRouterDeps) {
  const app = express();
  app.use(express.json());
  app.use("/api/health", healthRouter(deps));
  return app;
}

describe("REST /api/health", () => {
  it("returns ok:true when adapter is healthy", async () => {
    const app = buildApp({
      version: "1.2.3",
      startedAt: Date.now() - 5000,
      adapter: { healthCheck: async () => ({ ok: true }) },
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe("1.2.3");
    expect(res.body.adapter.ok).toBe(true);
    expect(typeof res.body.uptimeMs).toBe("number");
    expect(res.body.uptimeMs).toBeGreaterThanOrEqual(5000);
  });

  it("returns ok:false when adapter is unhealthy but status is still 200", async () => {
    const app = buildApp({
      version: "1.2.3",
      startedAt: Date.now(),
      adapter: { healthCheck: async () => ({ ok: false, detail: "no connection" }) },
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.adapter.ok).toBe(false);
    expect(res.body.adapter.detail).toBe("no connection");
  });
});
