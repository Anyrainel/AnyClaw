import { promises as fs } from "node:fs";
import path from "node:path";

export interface DeviceKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface TunnelConfig {
  serverToken: string;
  deviceKeys: DeviceKeys;
  brokerUrl: string;
}

export interface LoadOptions {
  secretsDir: string;
  brokerUrl?: string;
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

  return {
    serverToken,
    deviceKeys,
    brokerUrl: opts.brokerUrl ?? "wss://broker.anyclawapp.com",
  };
}
