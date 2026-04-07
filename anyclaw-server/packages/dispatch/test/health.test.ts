import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";

describe("dispatch stub", () => {
  it("GET /health returns 200 and status=ok with a version string", async () => {
    const app = createApp({ version: "0.1.0" });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", version: "0.1.0" });
  });

  it("returns 404 for unknown routes", async () => {
    const app = createApp({ version: "0.1.0" });
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(404);
  });
});
