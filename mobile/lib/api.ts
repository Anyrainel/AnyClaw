import sodium from "libsodium-wrappers";
import { encryptJSON, decryptJSON } from "./crypto";
import type { Envelope } from "./crypto";
import { loadPairingKeys } from "./crypto-storage";
import { LogBuffer } from "./log-buffer";

export const logBuffer = new LogBuffer();

interface ApiClientConfig {
  baseUrl: string;
  sessionToken: string;
  serverId: string;
  debug?: boolean;
}

export class ApiClient {
  private config: ApiClientConfig | null = null;

  configure(config: ApiClientConfig): void {
    this.config = config;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.config) {
      throw new Error("api client not configured");
    }

    const keys = await loadPairingKeys(this.config.serverId);
    if (!keys) {
      throw new Error("No pairing keys for server");
    }

    const clientPkBase64 = sodium.to_base64(keys.publicKey);

    // Log request in debug mode (plaintext to buffer, NEVER to network)
    if (this.config.debug) {
      logBuffer.push({
        timestamp: Date.now(),
        direction: "request",
        method: "POST",
        path,
        body,
      });
    }

    // Encrypt the body
    const envelope = encryptJSON(body, keys.serverPublicKey, keys.secretKey);

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-nacl-box",
        authorization: `Bearer ${this.config.sessionToken}`,
        "x-anyclaw-client-pk": clientPkBase64,
      },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const responseEnvelope = (await response.json()) as Envelope;
    const decrypted = decryptJSON<T>(
      responseEnvelope,
      keys.serverPublicKey,
      keys.secretKey
    );

    // Log response in debug mode
    if (this.config.debug) {
      logBuffer.push({
        timestamp: Date.now(),
        direction: "response",
        method: "POST",
        path,
        body: decrypted,
      });
    }

    return decrypted;
  }

  async get<T>(path: string): Promise<T> {
    if (!this.config) {
      throw new Error("api client not configured");
    }

    const keys = await loadPairingKeys(this.config.serverId);
    if (!keys) {
      throw new Error("No pairing keys for server");
    }

    const clientPkBase64 = sodium.to_base64(keys.publicKey);

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${this.config.sessionToken}`,
        "x-anyclaw-client-pk": clientPkBase64,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const responseEnvelope = (await response.json()) as Envelope;
    const decrypted = decryptJSON<T>(
      responseEnvelope,
      keys.serverPublicKey,
      keys.secretKey
    );

    // Log response in debug mode
    if (this.config.debug) {
      logBuffer.push({
        timestamp: Date.now(),
        direction: "response",
        method: "GET",
        path,
        body: decrypted,
      });
    }

    return decrypted;
  }
}

/** Singleton API client */
export const apiClient = new ApiClient();
