/**
 * WireGuard VPN module for AnyRaven mobile app.
 *
 * This is a platform abstraction layer. On iOS/Android it wraps
 * react-native-wireguard-vpn (or similar). In Expo Go / web, it stubs.
 */

export interface WireGuardConfig {
  privateKey: string;
  serverPublicKey: string;
  serverAddress: string;
  serverPort: number;
  address: string; // client tunnel IP, e.g. "10.64.0.2/32"
  allowedIPs: string[];
  dns?: string[];
  mtu?: number;
}

export interface WireGuardConnection {
  isConnected: boolean;
  tunnelName: string;
  serverAddress: string;
}

// Stub implementation for Expo Go / preview
class StubWireGuardVpn {
  private config: WireGuardConfig | null = null;

  async connect(cfg: WireGuardConfig): Promise<void> {
    this.config = cfg;
    console.log(`[wireguard:stub] Connect to ${cfg.serverAddress}:${cfg.serverPort}`);
  }

  async disconnect(): Promise<void> {
    this.config = null;
    console.log("[wireguard:stub] Disconnect");
  }

  getStatus(): WireGuardConnection {
    return {
      isConnected: this.config !== null,
      tunnelName: "anyraven-wg",
      serverAddress: this.config?.serverAddress ?? "",
    };
  }
}

// Singleton instance
const wireGuardVpn = new StubWireGuardVpn();

export async function connectWireGuard(config: WireGuardConfig): Promise<void> {
  return wireGuardVpn.connect(config);
}

export async function disconnectWireGuard(): Promise<void> {
  return wireGuardVpn.disconnect();
}

export function getWireGuardStatus(): WireGuardConnection {
  return wireGuardVpn.getStatus();
}

export function isWireGuardConnected(): boolean {
  return wireGuardVpn.getStatus().isConnected;
}
