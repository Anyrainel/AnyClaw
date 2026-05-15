import PocketBase from "pocketbase";
import { decryptJSON } from "../crypto";
import type { Envelope } from "../crypto";
import { loadPairingKeys } from "../crypto-storage";

let pb: PocketBase | null = null;

/**
 * Initialize PocketBase client with relay URL and auth token.
 */
export function initPocketBase(
  relayUrl: string,
  pbAuthToken: string,
  _serverId: string
): void {
  pb = new PocketBase(relayUrl);
  pb.authStore.save(pbAuthToken);
}

/**
 * Get the initialized PocketBase instance. Throws if not initialized.
 */
export function getPocketBase(): PocketBase {
  if (!pb) {
    throw new Error("PocketBase not initialized — call initPocketBase first");
  }
  return pb;
}

/**
 * @internal Reset for testing.
 */
export function _resetForTest(): void {
  pb = null;
}

/**
 * Subscribe to a task's SSE updates. Decrypts envelope records before
 * passing to callback. Returns an unsubscribe function.
 */
export async function subscribeToTask(
  taskId: string,
  onUpdate: (record: unknown) => void,
  serverId: string
): Promise<() => Promise<void>> {
  const instance = getPocketBase();
  const keys = await loadPairingKeys(serverId);
  if (!keys) throw new Error("No pairing keys for server");

  const topic = "*";

  const unsubscribe = await instance.collection("_tasks").subscribe(
    topic,
    (data: { action: string; record: unknown }) => {
      const decrypted = decryptJSON(
        data.record as Envelope,
        keys.serverPublicKey,
        keys.secretKey
      );
      onUpdate(decrypted);
    },
    {
      filter: `taskId="${taskId}"`,
      onerror: async (err: unknown) => {
        // Reconnect policy: refetch via REST and deliver to callback
        try {
          const record = await instance
            .collection("_tasks")
            .getFirstListItem(`taskId="${taskId}"`);
          const decrypted = decryptJSON(
            record as unknown as Envelope,
            keys.serverPublicKey,
            keys.secretKey
          );
          onUpdate(decrypted);
        } catch {
          // Best-effort recovery failed
        }
      },
    } as never
  );

  return async () => {
    unsubscribe();
  };
}

/**
 * Subscribe to agent messages. Decrypts envelope records.
 */
export async function subscribeToAgentMessages(
  onMessage: (record: unknown) => void,
  serverId: string
): Promise<() => Promise<void>> {
  const instance = getPocketBase();
  const keys = await loadPairingKeys(serverId);
  if (!keys) throw new Error("No pairing keys for server");

  await instance.collection("_agent_messages").subscribe(
    "*",
    (data: { action: string; record: unknown }) => {
      const decrypted = decryptJSON(
        data.record as Envelope,
        keys.serverPublicKey,
        keys.secretKey
      );
      onMessage(decrypted);
    }
  );

  return async () => {
    await instance.collection("_agent_messages").unsubscribe("*");
  };
}

/**
 * Subscribe to deployments. Only fires onDeploy for action === 'create'.
 * Decrypts envelope records.
 */
export async function subscribeToDeployments(
  onDeploy: (record: unknown) => void,
  serverId: string
): Promise<() => Promise<void>> {
  const instance = getPocketBase();
  const keys = await loadPairingKeys(serverId);
  if (!keys) throw new Error("No pairing keys for server");

  await instance.collection("_deployments").subscribe(
    "*",
    (data: { action: string; record: unknown }) => {
      if (data.action !== "create") return;
      const decrypted = decryptJSON(
        data.record as Envelope,
        keys.serverPublicKey,
        keys.secretKey
      );
      onDeploy(decrypted);
    }
  );

  return async () => {
    await instance.collection("_deployments").unsubscribe("*");
  };
}
