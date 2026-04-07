import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTunnelConfig } from "../src/config.js";

describe("loadTunnelConfig", () => {
  let root: string;
  let secretsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-tun-"));
    secretsDir = join(root, ".anyclaw");
    mkdirSync(secretsDir, { recursive: true });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("loads server token and device keys from .anyclaw/", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-123\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 1).toString("base64"),
        secretKey: Buffer.alloc(32, 2).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({ secretsDir });
    expect(cfg.serverToken).toBe("tok-123");
    expect(cfg.deviceKeys.publicKey.length).toBe(32);
    expect(cfg.deviceKeys.secretKey.length).toBe(32);
    expect(cfg.brokerUrl).toBe("wss://broker.anyclawapp.com");
  });

  it("throws when server-token is missing", async () => {
    await expect(loadTunnelConfig({ secretsDir })).rejects.toThrow(/server-token/);
  });
});
