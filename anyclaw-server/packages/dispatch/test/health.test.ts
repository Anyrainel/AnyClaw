import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { healthRouter } from "../src/rest/health.js";

describe("dispatch health", () => {
  it("GET /api/health returns 200 and ok:true with a version string", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api/health",
      healthRouter({
        version: "0.1.0",
        startedAt: Date.now(),
        adapter: { healthCheck: async () => ({ ok: true }) },
      }),
    );
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe("0.1.0");
  });

  it("returns 404 for unknown routes", async () => {
    const app = express();
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(404);
  });
});
