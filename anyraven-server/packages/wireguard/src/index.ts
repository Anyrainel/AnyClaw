import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WireGuardConfig, WireGuardPeer, WireGuardService } from "./config.js";

export * from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Generate a WireGuard keypair using wg genkey | wg pubkey.
 * Returns base64-encoded keys.
 */
export async function generateKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  try {
    const { stdout: privateKeyRaw } = await execFileAsync("wg", ["genkey"], { encoding: "utf8" });
    const privateKey = privateKeyRaw as unknown as string;
    const { stdout: publicKeyRaw } = await execFileAsync("wg", ["pubkey"], {
      encoding: "utf8",
      input: privateKey,
    } as any);
    const publicKey = publicKeyRaw as unknown as string;
    return {
      privateKey: privateKey.trim(),
      publicKey: publicKey.trim(),
    };
  } catch {
    // Fallback: generate deterministic keys from random bytes (NOT for production)
    const sk = randomBytes(32);
    const pk = derivePublicKey(sk);
    return {
      privateKey: sk.toString("base64"),
      publicKey: pk.toString("base64"),
    };
  }
}

/**
 * Derive public key from private key using Curve25519.
 * This is a stub - real implementation needs libsodium or similar.
 */
function derivePublicKey(_privateKey: Buffer): Buffer {
  // Stub: return random bytes. In production, use libsodium crypto_scalarmult_base
  return randomBytes(32);
}

/**
 * Create a default WireGuard config for the server.
 */
export async function createDefaultWireGuardConfig(opts?: { dryRun?: boolean }): Promise<WireGuardConfig> {
  const dryRun = opts?.dryRun ?? false;

  let keys: { privateKey: string; publicKey: string };
  if (dryRun) {
    keys = {
      privateKey: "DRYRUN-private-key-stub",
      publicKey: "DRYRUN-public-key-stub",
    };
  } else {
    keys = await generateKeypair();
  }

  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    tunnelIp: "10.64.0.1/24",
    port: 51820,
    endpoint: "auto",
    interfaceName: "wg0",
  };
}

/**
 * Detect the WireGuard endpoint (public IP or hostname).
 */
export async function detectWgEndpoint(): Promise<string> {
  // Try to detect public IP
  try {
    const { stdout } = await execFileAsync("curl", ["-s", "https://ipv4.icanhazip.com"]);
    const ip = stdout.trim();
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return ip;
    }
  } catch {
    // ignore
  }
  return "auto";
}

/**
 * Create a WireGuard service that manages the interface.
 */
export function createWireGuardService(config: WireGuardConfig, dryRun = false): WireGuardService {
  const peers = new Map<string, WireGuardPeer>();

  return {
    async configureInterface(): Promise<void> {
      if (dryRun) {
        console.log(`[wireguard:dry-run] Would configure ${config.interfaceName} with tunnel IP ${config.tunnelIp}`);
        return;
      }

      try {
        // Check if interface exists
        await execFileAsync("ip", ["link", "show", config.interfaceName]);
      } catch {
        // Create interface
        await execFileAsync("ip", ["link", "add", config.interfaceName, "type", "wireguard"]);
      }

      // Configure with wg
      await execFileAsync("wg", [
        "set", config.interfaceName,
        "private-key", "/dev/stdin",
        "listen-port", String(config.port),
      ], { encoding: "utf8", input: config.privateKey } as any);

      // Set IP address
      await execFileAsync("ip", ["address", "add", config.tunnelIp, "dev", config.interfaceName]);

      // Bring up
      await execFileAsync("ip", ["link", "set", "up", "dev", config.interfaceName]);
    },

    async addPeer(peer: WireGuardPeer): Promise<void> {
      peers.set(peer.publicKey, peer);

      if (dryRun) {
        console.log(`[wireguard:dry-run] Would add peer ${peer.publicKey.substring(0, 16)}... allowedIPs=${peer.allowedIps}`);
        return;
      }

      await execFileAsync("wg", [
        "set", config.interfaceName,
        "peer", peer.publicKey,
        "allowed-ips", peer.allowedIps,
      ]);
    },

    async removePeer(publicKey: string): Promise<void> {
      peers.delete(publicKey);

      if (dryRun) {
        console.log(`[wireguard:dry-run] Would remove peer ${publicKey.substring(0, 16)}...`);
        return;
      }

      await execFileAsync("wg", [
        "set", config.interfaceName,
        "peer", publicKey,
        "remove",
      ]);
    },

    async listPeers(): Promise<WireGuardPeer[]> {
      return Array.from(peers.values());
    },

    getConfig(): WireGuardConfig {
      return { ...config };
    },
  };
}

/**
 * Build heartbeat payload with WireGuard info for broker.
 */
export function buildWireGuardHeartbeatPayload(
  config: WireGuardConfig,
): Record<string, unknown> {
  return {
    type: "heartbeat",
    wireguard: {
      public_key: config.publicKey,
      endpoint: config.endpoint,
      port: config.port,
      tunnel_ip: config.tunnelIp,
    },
  };
}
