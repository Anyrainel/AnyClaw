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
    expect(cfg.mode).toBe("broker");
    expect(cfg.brokerUrl).toBe("wss://broker.anyclawapp.com");
    expect(cfg.tunnelUrl).toBeUndefined();
  });

  it("uses direct mode when tunnelUrl is provided", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-456\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 3).toString("base64"),
        secretKey: Buffer.alloc(32, 4).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({ secretsDir, tunnelUrl: "wss://my-tunnel.ngrok.io" });
    expect(cfg.serverToken).toBe("tok-456");
    expect(cfg.mode).toBe("direct");
    expect(cfg.tunnelUrl).toBe("wss://my-tunnel.ngrok.io");
    expect(cfg.brokerUrl).toBeUndefined();
  });

  it("uses broker mode when tunnelUrl is empty/whitespace", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-789\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 5).toString("base64"),
        secretKey: Buffer.alloc(32, 6).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({ secretsDir, tunnelUrl: "   " });
    expect(cfg.mode).toBe("broker");
    expect(cfg.brokerUrl).toBe("wss://broker.anyclawapp.com");
    expect(cfg.tunnelUrl).toBeUndefined();
  });

  it("uses explicit mode when provided", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-wg\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 7).toString("base64"),
        secretKey: Buffer.alloc(32, 8).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({ secretsDir, mode: "wireguard" });
    expect(cfg.mode).toBe("wireguard");
    expect(cfg.brokerUrl).toBe("wss://broker.anyclawapp.com");
    expect(cfg.wireguard).toBeDefined();
    expect(cfg.wireguard?.tunnelIp).toBe("10.64.0.1/24");
    expect(cfg.wireguard?.port).toBe(51820);
  });

  it("uses public_ip mode with endpoint config", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-pub\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 9).toString("base64"),
        secretKey: Buffer.alloc(32, 10).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({
      secretsDir,
      mode: "public_tunnel",
      publicHost: "203.0.113.42",
      publicApiPort: 4100,
      publicAppPort: 5173,
      publicPbPort: 8090,
      publicUseTls: true,
    });
    expect(cfg.mode).toBe("public_tunnel");
    expect(cfg.publicEndpoint).toEqual({
      host: "203.0.113.42",
      apiPort: 4100,
      appPort: 5173,
      pbPort: 8090,
      useTls: true,
    });
    expect(cfg.brokerUrl).toBe("wss://broker.anyclawapp.com");
  });

  it("uses public_tunnel mode with tunnelUrl and endpoint config", async () => {
    writeFileSync(join(secretsDir, "server-token"), "tok-pt\n");
    writeFileSync(
      join(secretsDir, "device-keys.json"),
      JSON.stringify({
        publicKey: Buffer.alloc(32, 11).toString("base64"),
        secretKey: Buffer.alloc(32, 12).toString("base64"),
      }),
    );
    const cfg = await loadTunnelConfig({
      secretsDir,
      mode: "public_tunnel",
      tunnelUrl: "https://myserver.cloudflare.io",
      publicHost: "myserver.cloudflare.io",
      publicUseTls: true,
    });
    expect(cfg.mode).toBe("public_tunnel");
    expect(cfg.tunnelUrl).toBe("https://myserver.cloudflare.io");
    expect(cfg.publicEndpoint).toBeDefined();
    expect(cfg.publicEndpoint?.host).toBe("myserver.cloudflare.io");
  });

  it("throws when server-token is missing", async () => {
    await expect(loadTunnelConfig({ secretsDir })).rejects.toThrow(/server-token/);
  });
});
