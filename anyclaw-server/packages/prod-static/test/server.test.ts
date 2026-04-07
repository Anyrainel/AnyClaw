import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createProdStaticApp } from "../src/index.js";

describe("prod-static", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-ps-"));
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("serves the placeholder when the build dir is empty", async () => {
    mkdirSync(root, { recursive: true });
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Welcome to AnyClaw/);
    expect(res.text).toMatch(/has not built anything yet/);
  });

  it("serves index.html when the build dir has content", async () => {
    writeFileSync(join(root, "index.html"), "<html><body>APP</body></html>");
    writeFileSync(join(root, "app.js"), "console.log(1)");
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("APP");
  });

  it("serves static assets", async () => {
    writeFileSync(join(root, "index.html"), "<html></html>");
    writeFileSync(join(root, "app.js"), "console.log(1)");
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("console.log");
  });

  it("falls back to index.html for SPA routes", async () => {
    writeFileSync(join(root, "index.html"), "<html>SPA</html>");
    const app = createProdStaticApp({ buildDir: root });
    const res = await request(app).get("/settings/profile");
    expect(res.status).toBe(200);
    expect(res.text).toContain("SPA");
  });
});
