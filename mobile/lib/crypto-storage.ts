import sodium from "libsodium-wrappers";
import * as SecureStore from "expo-secure-store";

export interface PairingKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  serverPublicKey: Uint8Array;
}

function storeKey(serverId: string): string {
  return `pairing_keys_${serverId}`;
}

/**
 * Store pairing keys for a server in SecureStore.
 */
export async function storePairingKeys(
  serverId: string,
  keys: PairingKeys
): Promise<void> {
  const serialized = JSON.stringify({
    publicKey: sodium.to_base64(keys.publicKey),
    secretKey: sodium.to_base64(keys.secretKey),
    serverPublicKey: sodium.to_base64(keys.serverPublicKey),
  });
  await SecureStore.setItemAsync(storeKey(serverId), serialized);
}

/**
 * Load pairing keys for a server from SecureStore.
 */
export async function loadPairingKeys(
  serverId: string
): Promise<PairingKeys | null> {
  const raw = await SecureStore.getItemAsync(storeKey(serverId));
  if (!raw) return null;

  const parsed = JSON.parse(raw) as {
    publicKey: string;
    secretKey: string;
    serverPublicKey: string;
  };

  return {
    publicKey: sodium.from_base64(parsed.publicKey),
    secretKey: sodium.from_base64(parsed.secretKey),
    serverPublicKey: sodium.from_base64(parsed.serverPublicKey),
  };
}
