export interface PublicEndpointConfig {
  host: string;
  apiPort: number;
  appPort: number;
  pbPort: number;
  useTls: boolean;
}

export interface DetectedEndpoint {
  ipv4: string | null;
  ipv6: string | null;
}
