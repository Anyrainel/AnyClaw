import { describe, it, expect, vi } from "vitest";
import {
  generateKeypair,
  createDefaultWireGuardConfig,
  createWireGuardService,
  buildWireGuardHeartbeatPayload,
} from "../src/index.js";

describe("wireguard", () => {
  describe("generateKeypair", () => {
    it("generates keys with correct length", async () => {
      const keys = await generateKeypair();
      expect(keys.privateKey).toBeDefined();
      expect(keys.publicKey).toBeDefined();
      expect(keys.privateKey.length).toBeGreaterThan(0);
      expect(keys.publicKey.length).toBeGreaterThan(0);
    });

    it("generates different keys on each call", async () => {
      const keys1 = await generateKeypair();
      const keys2 = await generateKeypair();
      expect(keys1.privateKey).not.toBe(keys2.privateKey);
      expect(keys1.publicKey).not.toBe(keys2.publicKey);
    });
  });

  describe("createDefaultWireGuardConfig", () => {
    it("creates config with default values", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      expect(cfg.tunnelIp).toBe("10.64.0.1/24");
      expect(cfg.port).toBe(51820);
      expect(cfg.endpoint).toBe("auto");
      expect(cfg.interfaceName).toBe("wg0");
    });

    it("uses stub keys in dry run mode", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      expect(cfg.privateKey).toContain("DRYRUN");
      expect(cfg.publicKey).toContain("DRYRUN");
    });

    it("generates real keys when not dry run", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: false });
      expect(cfg.privateKey).toBeDefined();
      expect(cfg.publicKey).toBeDefined();
      expect(cfg.privateKey).not.toContain("DRYRUN");
    });
  });

  describe("createWireGuardService", () => {
    it("adds and lists peers", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      const svc = createWireGuardService(cfg, true);

      await svc.addPeer({
        publicKey: "client-pub-key",
        allowedIps: "10.64.0.2/32",
      });

      const peers = await svc.listPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0]!.publicKey).toBe("client-pub-key");
    });

    it("removes peers", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      const svc = createWireGuardService(cfg, true);

      await svc.addPeer({
        publicKey: "client-pub-key",
        allowedIps: "10.64.0.2/32",
      });
      await svc.removePeer("client-pub-key");

      const peers = await svc.listPeers();
      expect(peers).toHaveLength(0);
    });

    it("configureInterface logs in dry run", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      const svc = createWireGuardService(cfg, true);
      await svc.configureInterface();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("dry-run"),
      );
      consoleSpy.mockRestore();
    });

    it("getConfig returns the config", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      const svc = createWireGuardService(cfg, true);
      expect(svc.getConfig()).toEqual(cfg);
    });

    it("multiple peers can be added", async () => {
      const cfg = await createDefaultWireGuardConfig({ dryRun: true });
      const svc = createWireGuardService(cfg, true);

      await svc.addPeer({ publicKey: "peer1", allowedIps: "10.64.0.2/32" });
      await svc.addPeer({ publicKey: "peer2", allowedIps: "10.64.0.3/32" });

      const peers = await svc.listPeers();
      expect(peers).toHaveLength(2);
    });
  });

  describe("buildWireGuardHeartbeatPayload", () => {
    it("includes wireguard info in heartbeat", () => {
      const payload = buildWireGuardHeartbeatPayload({
        privateKey: "priv",
        publicKey: "pub",
        tunnelIp: "10.64.0.1/24",
        port: 51820,
        endpoint: "203.0.113.42",
        interfaceName: "wg0",
      });
      expect(payload.type).toBe("heartbeat");
      expect(payload.wireguard).toEqual({
        public_key: "pub",
        endpoint: "203.0.113.42",
        port: 51820,
        tunnel_ip: "10.64.0.1/24",
      });
    });
  });
});
