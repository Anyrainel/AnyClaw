import { describe, it, expect, vi } from "vitest";
import {
  detectPublicIp,
  detectPublicEndpoint,
  buildPublicEndpointConfig,
  buildHeartbeatPayload,
} from "../src/index.js";

describe("direct-connect", () => {
  describe("detectPublicIp", () => {
    it("returns null when all services fail", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
      const ip = await detectPublicIp();
      expect(ip).toBeNull();
    });

    it("returns IP from first successful service", async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "203.0.113.42",
        } as Response);
      const ip = await detectPublicIp();
      expect(ip).toBe("203.0.113.42");
    });

    it("skips invalid IP responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "not-an-ip",
      } as Response);
      const ip = await detectPublicIp();
      expect(ip).toBeNull();
    });

    it("skips empty responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "",
      } as Response);
      const ip = await detectPublicIp();
      expect(ip).toBeNull();
    });

    it("handles non-ok responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      } as Response);
      const ip = await detectPublicIp();
      expect(ip).toBeNull();
    });
  });

  describe("detectPublicEndpoint", () => {
    it("returns both IPv4 and IPv6 (IPv6 null for now)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "203.0.113.42",
      } as Response);
      const ep = await detectPublicEndpoint();
      expect(ep.ipv4).toBe("203.0.113.42");
      expect(ep.ipv6).toBeNull();
    });

    it("returns nulls when detection fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("fail"));
      const ep = await detectPublicEndpoint();
      expect(ep.ipv4).toBeNull();
      expect(ep.ipv6).toBeNull();
    });
  });

  describe("buildPublicEndpointConfig", () => {
    it("returns null when no IP detected", () => {
      const cfg = buildPublicEndpointConfig(
        { ipv4: null, ipv6: null },
        { api: 4100, app: 5173, pb: 8090 },
        true,
      );
      expect(cfg).toBeNull();
    });

    it("prefers IPv4 over IPv6", () => {
      const cfg = buildPublicEndpointConfig(
        { ipv4: "203.0.113.42", ipv6: "::1" },
        { api: 4100, app: 5173, pb: 8090 },
        true,
      );
      expect(cfg?.host).toBe("203.0.113.42");
    });

    it("falls back to IPv6 when IPv4 is null", () => {
      const cfg = buildPublicEndpointConfig(
        { ipv4: null, ipv6: "2001:db8::1" },
        { api: 4100, app: 5173, pb: 8090 },
        false,
      );
      expect(cfg?.host).toBe("2001:db8::1");
      expect(cfg?.useTls).toBe(false);
    });

    it("builds config from detected IPv4", () => {
      const cfg = buildPublicEndpointConfig(
        { ipv4: "203.0.113.42", ipv6: null },
        { api: 4100, app: 5173, pb: 8090 },
        true,
      );
      expect(cfg).toEqual({
        host: "203.0.113.42",
        apiPort: 4100,
        appPort: 5173,
        pbPort: 8090,
        useTls: true,
      });
    });
  });

  describe("buildHeartbeatPayload", () => {
    it("includes endpoint info in heartbeat", () => {
      const payload = buildHeartbeatPayload({
        host: "203.0.113.42",
        apiPort: 4100,
        appPort: 5173,
        pbPort: 8090,
        useTls: true,
      });
      expect(payload.type).toBe("heartbeat");
      expect(payload.public_endpoint).toEqual({
        host: "203.0.113.42",
        api_port: 4100,
        app_port: 5173,
        pb_port: 8090,
        use_tls: true,
      });
    });
  });
});
