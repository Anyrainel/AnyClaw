import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPocketBaseAdmin, __resetPbClientForTests } from "../src/pocketbase-client.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anyraven-pb-"));
  process.env.ANYRAVEN_DATA_ROOT = tmp;
  fs.mkdirSync(path.join(tmp, ".anyraven"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".anyraven", "pb-token"), "file-token-xyz");
  __resetPbClientForTests();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ANYRAVEN_DATA_ROOT;
  delete process.env.PB_ADMIN_TOKEN;
  delete process.env.POCKETBASE_URL;
});

describe("PocketBase client", () => {
  it("uses env token when set", () => {
    process.env.PB_ADMIN_TOKEN = "env-token";
    const pb = getPocketBaseAdmin();
    expect(pb.authStore.token).toBe("env-token");
  });
  it("falls back to pb-token file", () => {
    const pb = getPocketBaseAdmin();
    expect(pb.authStore.token).toBe("file-token-xyz");
  });
  it("is a singleton", () => {
    expect(getPocketBaseAdmin()).toBe(getPocketBaseAdmin());
  });
});
