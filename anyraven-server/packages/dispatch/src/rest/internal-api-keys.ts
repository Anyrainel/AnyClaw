import { Router } from "express";
import { z } from "zod";
import { readFile } from "fs/promises";
import { createCipheriv, randomBytes } from "crypto";
import type { PocketBaseLike } from "../persistence/tasks-repo.js";

const Body = z.object({
  name: z.string().min(1).max(64),
  plaintext: z.string().min(1),
});

export interface InternalApiKeysDeps {
  pb: PocketBaseLike;
  masterKeyPath: string;
}

/**
 * Encrypt plaintext with AES-256-GCM using the master key.
 * Returns base64-encoded string: nonce (12 bytes) + authTag (16 bytes) + ciphertext.
 */
function sealWithMasterKey(plaintext: Buffer, masterKey: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, authTag, encrypted]).toString("base64");
}

export function internalApiKeysRouter(deps: InternalApiKeysDeps): Router {
  const r = Router();

  // Loopback-only guard
  r.use((req, res, next) => {
    const ip = req.ip;
    if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
      res.status(403).json({ error: "loopback_only" });
      return;
    }
    next();
  });

  r.post("/api-keys", async (req, res, next) => {
    try {
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
        return;
      }

      let masterKey: Buffer;
      try {
        masterKey = await readFile(deps.masterKeyPath);
      } catch {
        res.status(500).json({ error: "master_key_missing" });
        return;
      }

      const sealed = sealWithMasterKey(Buffer.from(parsed.data.plaintext, "utf8"), masterKey);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const col = deps.pb.collection("_api_keys") as any;
      try {
        const existing = await col.getFirstListItem(`name = "${parsed.data.name}"`);
        await col.update(existing.id, { sealed });
      } catch {
        await col.create({ name: parsed.data.name, sealed });
      }

      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
