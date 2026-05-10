import type { PublicEndpointConfig, DetectedEndpoint } from "./config.js";

export * from "./config.js";

const IP_DETECTION_URLS = [
  "https://ipv4.icanhazip.com",
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
];

/**
 * Detect the server's public IPv4 address using multiple fallback services.
 * Returns null if detection fails (e.g. behind NAT with no public IP).
 */
export async function detectPublicIp(): Promise<string | null> {
  for (const url of IP_DETECTION_URLS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const ip = (await response.text()).trim();
        // Basic IPv4 validation
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
          return ip;
        }
      }
    } catch {
      // Try next URL
    }
  }
  return null;
}

/**
 * Detect both IPv4 and IPv6 public addresses.
 */
export async function detectPublicEndpoint(): Promise<DetectedEndpoint> {
  const ipv4 = await detectPublicIp();
  // IPv6 detection can be added later
  return { ipv4, ipv6: null };
}

/**
 * Build a PublicEndpointConfig from detected IP and service ports.
 */
export function buildPublicEndpointConfig(
  detected: DetectedEndpoint,
  ports: { api: number; app: number; pb: number },
  useTls: boolean,
): PublicEndpointConfig | null {
  const host = detected.ipv4 ?? detected.ipv6;
  if (!host) return null;

  return {
    host,
    apiPort: ports.api,
    appPort: ports.app,
    pbPort: ports.pb,
    useTls,
  };
}

/**
 * Build heartbeat payload with public endpoint info for broker.
 */
export function buildHeartbeatPayload(
  endpoint: PublicEndpointConfig,
): Record<string, unknown> {
  return {
    type: "heartbeat",
    public_endpoint: {
      host: endpoint.host,
      api_port: endpoint.apiPort,
      app_port: endpoint.appPort,
      pb_port: endpoint.pbPort,
      use_tls: endpoint.useTls,
    },
  };
}
