import fs from "node:fs";
import PocketBase from "pocketbase";
import { POCKETBASE_URL, currentPaths } from "./env.js";

let pb: PocketBase | null = null;

export function __resetPbClientForTests(): void {
  pb = null;
}

export function getPocketBaseAdmin(): PocketBase {
  if (pb) return pb;
  const token =
    process.env.PB_ADMIN_TOKEN ??
    fs.readFileSync(currentPaths().pbTokenFile, "utf8").trim();
  pb = new PocketBase(POCKETBASE_URL);
  pb.authStore.save(token, null);
  return pb;
}

/** Retry helper: 3 attempts at 1s/2s/4s for transient PocketBase outages. */
export async function withPbRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 2000, 4000];
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === delays.length) break;
      const d = delays[i] ?? 1000;
      await new Promise((r) => setTimeout(r, d));
    }
  }
  throw lastErr;
}
