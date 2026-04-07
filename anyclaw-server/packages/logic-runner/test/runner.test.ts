import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogicRunner } from "../src/index.js";

describe("LogicRunner", () => {
  let root: string;
  let buildDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-lr-"));
    buildDir = join(root, "logic-build");
    mkdirSync(buildDir, { recursive: true });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("reports mode=fallback when index.js is missing", async () => {
    const runner = new LogicRunner({ buildDir, port: 0 });
    await runner.start();
    expect(runner.mode).toBe("fallback");
    await runner.stop();
  });

  it("reports mode=running when index.js exists", async () => {
    writeFileSync(join(buildDir, "index.js"), "// agent logic");
    const runner = new LogicRunner({ buildDir, port: 0 });
    await runner.start();
    expect(runner.mode).toBe("running");
    await runner.stop();
  });

  it("transitions from fallback to running when index.js appears", async () => {
    const runner = new LogicRunner({ buildDir, port: 0 });
    await runner.start();
    expect(runner.mode).toBe("fallback");
    writeFileSync(join(buildDir, "index.js"), "// later");
    await runner.reloadForTest();
    expect(runner.mode).toBe("running");
    await runner.stop();
  });
});
