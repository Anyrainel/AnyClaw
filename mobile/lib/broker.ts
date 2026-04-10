import * as SecureStore from "expo-secure-store";
import { AuthRequest, makeRedirectUri } from "expo-auth-session";

const BROKER_BASE = "https://broker.anyclawapp.com";

/**
 * Authenticate with the broker using OAuth.
 */
export async function loginWithProvider(
  provider: "google" | "apple" | "github"
): Promise<void> {
  const redirectUri = makeRedirectUri({ scheme: "anyclaw" });
  const authUrl = `${BROKER_BASE}/auth/${provider}/start`;

  const request = new AuthRequest({
    clientId: "anyclaw-mobile",
    redirectUri,
    usePKCE: false,
    scopes: [],
  });

  const result = await request.promptAsync({
    authorizationEndpoint: authUrl,
  } as never);

  if (result.type !== "success") {
    throw new Error("OAuth cancelled");
  }

  const code = (result as { type: "success"; params: { code: string } }).params.code;

  const response = await fetch(`${BROKER_BASE}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });

  if (!response.ok) {
    throw new Error(`Exchange failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
  };

  await SecureStore.setItemAsync("broker_jwt", data.access_token);
  await SecureStore.setItemAsync("broker_refresh", data.refresh_token);
}

/**
 * Refresh the broker JWT using the stored refresh token.
 */
export async function refreshBrokerJwt(): Promise<string> {
  const refreshToken = await SecureStore.getItemAsync("broker_refresh");
  if (!refreshToken) {
    throw new Error("No refresh token");
  }

  const response = await fetch(`${BROKER_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new Error("Refresh failed");
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
  };

  await SecureStore.setItemAsync("broker_jwt", data.access_token);
  await SecureStore.setItemAsync("broker_refresh", data.refresh_token);

  return data.access_token;
}

/**
 * Fetch the list of servers from the broker, auto-refreshing on 401.
 */
export async function fetchServers(): Promise<{ servers: Array<{ id: string; name: string }> }> {
  const makeRequest = async (jwt: string) => {
    return fetch(`${BROKER_BASE}/api/servers`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
  };

  let jwt = await SecureStore.getItemAsync("broker_jwt");
  if (!jwt) throw new Error("Not authenticated");

  let response = await makeRequest(jwt);

  if (response.status === 401) {
    jwt = await refreshBrokerJwt();
    response = await makeRequest(jwt);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as { servers: Array<{ id: string; name: string }> };
}

/**
 * Request pairing with a server. Sends client public key, receives server public key.
 */
export async function requestPairing(
  serverId: string,
  clientPublicKey: Uint8Array
): Promise<{ serverPublicKey: Uint8Array }> {
  const jwt = await SecureStore.getItemAsync("broker_jwt");
  if (!jwt) throw new Error("Not authenticated");

  const clientPkBase64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(clientPublicKey).toString("base64")
      : btoa(String.fromCharCode(...clientPublicKey));

  const response = await fetch(`${BROKER_BASE}/api/pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      serverId,
      clientPublicKey: clientPkBase64,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as { serverPublicKey: string };

  // Decode base64 to Uint8Array
  let serverPk: Uint8Array;
  if (typeof Buffer !== "undefined") {
    serverPk = new Uint8Array(Buffer.from(data.serverPublicKey, "base64"));
  } else {
    const binary = atob(data.serverPublicKey);
    serverPk = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      serverPk[i] = binary.charCodeAt(i);
    }
  }

  return { serverPublicKey: serverPk };
}

/**
 * Establish a tunnel to a server through the broker relay.
 */
export async function establishTunnel(
  serverId: string
): Promise<{ relayUrl: string; sessionToken: string; pbAuthToken: string }> {
  const jwt = await SecureStore.getItemAsync("broker_jwt");
  if (!jwt) throw new Error("Not authenticated");

  const response = await fetch(`${BROKER_BASE}/api/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ serverId }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as {
    relayUrl: string;
    sessionToken: string;
    pbAuthToken: string;
  };
}
