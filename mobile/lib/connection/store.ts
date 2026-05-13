import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { apiClient } from "../api";
import { refreshBrokerJwt } from "../broker";
import { initPocketBase } from "../pocketbase";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export type ConnectionMode = "public_ip" | "wireguard" | "public_tunnel" | "broker_relay";

const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 16000, 30000];

function getBackoffDelay(attempt: number): number {
  if (attempt >= BACKOFF_SCHEDULE.length) {
    return BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1];
  }
  return BACKOFF_SCHEDULE[attempt];
}

interface ConnectionStore {
  isAuthenticated: boolean;
  isConnected: boolean;
  serverUrl: string | null;
  sessionToken: string | null;
  pbAuthToken: string | null;
  connectionState: ConnectionState;
  connectionMode: ConnectionMode;
  _backoffAttempt: number;

  restoreSession: () => Promise<void>;
  reconnect: (delayFn?: (ms: number) => Promise<void>) => Promise<void>;
  logout: () => Promise<void>;
}

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  isAuthenticated: false,
  isConnected: false,
  serverUrl: null,
  sessionToken: null,
  pbAuthToken: null,
  connectionState: "disconnected",
  connectionMode: "broker_relay",
  _backoffAttempt: 0,

  restoreSession: async () => {
    const jwt = await SecureStore.getItemAsync("broker_jwt");
    if (!jwt) return;

    const sessionToken = await SecureStore.getItemAsync("session_token");
    const serverUrl = await SecureStore.getItemAsync("server_url");
    const connectionMode = (await SecureStore.getItemAsync("connection_mode")) as ConnectionMode ?? "broker_relay";

    if (!sessionToken || !serverUrl) {
      set({ isAuthenticated: true, connectionMode });
      return;
    }

    set({
      isAuthenticated: true,
      serverUrl,
      sessionToken,
      connectionMode,
      connectionState: "connecting",
    });

    // Configure API client
    apiClient.configure({
      baseUrl: serverUrl,
      sessionToken,
      serverId: "default",
    });

    // Try health check
    try {
      await apiClient.get("/api/health");
      set({
        isConnected: true,
        connectionState: "connected",
      });
    } catch {
      // Health check failed — transition to reconnecting
      set({ connectionState: "reconnecting" });
    }
  },

  reconnect: async (delayFn = defaultDelay) => {
    let attempt = 0;
    const { connectionMode } = get();

    while (true) {
      // On first attempt, refresh broker JWT only in broker_relay mode
      if (attempt === 0 && connectionMode === "broker_relay") {
        try {
          await refreshBrokerJwt();
        } catch {
          // Best-effort refresh
        }
      }

      const delay = getBackoffDelay(attempt);
      await delayFn(delay);
      attempt++;

      try {
        await apiClient.get("/api/health");
        set({
          isConnected: true,
          connectionState: "connected",
          _backoffAttempt: 0,
        });
        return;
      } catch {
        // Continue retrying
      }
    }
  },

  logout: async () => {
    await SecureStore.deleteItemAsync("broker_jwt");
    await SecureStore.deleteItemAsync("session_token");
    await SecureStore.deleteItemAsync("server_url");
    await SecureStore.deleteItemAsync("connection_mode");

    set({
      isAuthenticated: false,
      isConnected: false,
      serverUrl: null,
      sessionToken: null,
      pbAuthToken: null,
      connectionState: "disconnected",
      connectionMode: "broker_relay",
      _backoffAttempt: 0,
    });
  },
}));
