import { promises as fs } from "node:fs";
import path from "node:path";

export interface DeviceKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface TunnelConfig {
  mode: "broker" | "direct" | "wireguard" | "public_tunnel";
  serverToken: string;
  deviceKeys: DeviceKeys;
  brokerUrl?: string | undefined;
  tunnelUrl?: string | undefined;
  wireguard?: {
    publicKey: string;
    privateKey: string;
    tunnelIp: string;
    port: number;
    endpoint: string;
  } | undefined;
  publicEndpoint?: {
    host: string;
    apiPort: number;
    appPort: number;
    pbPort: number;
    useTls: boolean;
  } | undefined;
}

export interface LoadOptions {
  secretsDir: string;
  brokerUrl?: string | undefined;
  tunnelUrl?: string | undefined;
  mode?: "broker" | "direct" | "wireguard" | "public_tunnel" | undefined;
  /** Public endpoint config (for public_ip or public_tunnel modes) */
  publicHost?: string | undefined;
  publicApiPort?: number | undefined;
  publicAppPort?: number | undefined;
  publicPbPort?: number | undefined;
  publicUseTls?: boolean | undefined;
  /** WireGuard config (for wireguard mode) */
  wgPublicKey?: string | undefined;
  wgPrivateKey?: string | undefined;
  wgTunnelIp?: string | undefined;
  wgPort?: number | undefined;
  wgEndpoint?: string | undefined;
}

export async function loadTunnelConfig(opts: LoadOptions): Promise<TunnelConfig> {
  const tokenPath = path.join(opts.secretsDir, "server-token");
  const keysPath  = path.join(opts.secretsDir, "device-keys.json");

  let serverToken: string;
  try {
    serverToken = (await fs.readFile(tokenPath, "utf8")).trim();
  } catch {
    throw new Error(`tunnel-manager: missing server-token at ${tokenPath}`);
  }
  if (!serverToken) throw new Error(`tunnel-manager: empty server-token at ${tokenPath}`);

  const keysRaw = await fs.readFile(keysPath, "utf8");
  const parsed = JSON.parse(keysRaw) as { publicKey: string; secretKey: string };
  const deviceKeys: DeviceKeys = {
    publicKey: Buffer.from(parsed.publicKey, "base64"),
    secretKey: Buffer.from(parsed.secretKey, "base64"),
  };

  // Determine mode from explicit option, tunnelUrl, or default to broker
  const explicitMode = opts.mode?.trim();
  const tunnelUrl = opts.tunnelUrl?.trim();

  let mode: TunnelConfig["mode"];
  if (explicitMode) {
    mode = explicitMode as TunnelConfig["mode"];
  } else if (tunnelUrl) {
    mode = "direct";
  } else {
    mode = "broker";
  }

  const brokerUrl = opts.brokerUrl ?? "wss://broker.anyclawapp.com";

  const cfg: TunnelConfig = {
    mode,
    serverToken,
    deviceKeys,
    brokerUrl: mode === "broker" || mode === "wireguard" || mode === "public_tunnel" ? brokerUrl : undefined,
    tunnelUrl: mode === "direct" || mode === "public_tunnel" ? tunnelUrl : undefined,
  };

  if (mode === "public_tunnel") {
    cfg.publicEndpoint = {
      host: opts.publicHost ?? "",
      apiPort: opts.publicApiPort ?? 4100,
      appPort: opts.publicAppPort ?? 5173,
      pbPort: opts.publicPbPort ?? 8090,
      useTls: opts.publicUseTls ?? true,
    };
  }

  if (mode === "wireguard") {
    cfg.wireguard = {
      publicKey: opts.wgPublicKey ?? "",
      privateKey: opts.wgPrivateKey ?? "",
      tunnelIp: opts.wgTunnelIp ?? "10.64.0.1/24",
      port: opts.wgPort ?? 51820,
      endpoint: opts.wgEndpoint ?? "auto",
    };
  }

  return cfg;
}
