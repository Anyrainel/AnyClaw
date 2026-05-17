export interface WireGuardConfig {
  /** Server private key (base64) */
  privateKey: string;
  /** Server public key (base64) */
  publicKey: string;
  /** Tunnel IP with CIDR, e.g. "10.64.0.1/24" */
  tunnelIp: string;
  /** Listen port */
  port: number;
  /** Endpoint host:port or "auto" */
  endpoint: string;
  /** Interface name */
  interfaceName: string;
}

export interface WireGuardPeer {
  /** Client public key (base64) */
  publicKey: string;
  /** Client tunnel IP, e.g. "10.64.0.2/32" */
  allowedIps: string;
  /** Optional preshared key */
  presharedKey?: string;
}

export interface WireGuardService {
  configureInterface(): Promise<void>;
  addPeer(peer: WireGuardPeer): Promise<void>;
  removePeer(publicKey: string): Promise<void>;
  listPeers(): Promise<WireGuardPeer[]>;
  getConfig(): WireGuardConfig;
}
