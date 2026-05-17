import { describe, it, expect } from "vitest";
import request from "supertest";
import { createFallbackApp } from "../src/fallback.js";

describe("app-backend fallback", () => {
  it("returns 503 with no_app_backend_deployed for any route", async () => {
    const app = createFallbackApp();
    const a = await request(app).get("/");
    expect(a.status).toBe(503);
    expect(a.body).toEqual({ error: "no_app_backend_deployed" });

    const b = await request(app).post("/api/anything");
    expect(b.status).toBe(503);
    expect(b.body).toEqual({ error: "no_app_backend_deployed" });
  });
});
