import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { randomBytes } from "crypto";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { internalApiKeysRouter, type InternalApiKeysDeps } from "../../src/rest/internal-api-keys.js";
import { makeFakePb, type FakePb } from "../unit/helpers/fake-pb.js";

let app: Express;
let pb: FakePb;
let masterKeyPath: string;
let tempDir: string;

async function buildTestApp(opts?: { noMasterKey?: boolean }) {
  pb = makeFakePb();
  tempDir = join(tmpdir(), `anyraven-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  masterKeyPath = join(tempDir, "master.key");

  if (!opts?.noMasterKey) {
    // Write a 32-byte master key
    const masterKey = randomBytes(32);
    await writeFile(masterKeyPath, masterKey);
  }

  const deps: InternalApiKeysDeps = { pb, masterKeyPath };

  const a = express();
  // trust proxy off — default
  a.use(express.json());
  a.use("/internal", internalApiKeysRouter(deps));
  return a;
}

describe("REST POST /internal/api-keys", () => {
  afterEach(async () => {
    try {
      await unlink(masterKeyPath);
    } catch {
      // ignore
    }
  });

  it("encrypts and stores an API key, returns 204", async () => {
    app = await buildTestApp();
    const res = await request(app)
      .post("/internal/api-keys")
      .send({ name: "anthropic", plaintext: "sk-ant-123" });
    expect(res.status).toBe(204);

    // Verify the row was stored
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (pb.collection("_api_keys") as any).getFirstListItem('name = "anthropic"') as Record<string, unknown>;
    expect(row.name).toBe("anthropic");
    expect(typeof row.sealed).toBe("string");
    // sealed should be base64 and not the plaintext
    expect(row.sealed).not.toBe("sk-ant-123");
  });

  it("second request with same name upserts (overwrites)", async () => {
    app = await buildTestApp();
    await request(app)
      .post("/internal/api-keys")
      .send({ name: "anthropic", plaintext: "sk-v1" });
    await request(app)
      .post("/internal/api-keys")
      .send({ name: "anthropic", plaintext: "sk-v2" });

    // Should still be just one row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (pb.collection("_api_keys") as any).getFullList() as Array<Record<string, unknown>>;
    const matching = rows.filter((r) => r.name === "anthropic");
    expect(matching.length).toBe(1);
  });

  it("rejects non-loopback requests with 403", async () => {
    app = await buildTestApp();
    // Simulate non-loopback by setting X-Forwarded-For
    // With trust proxy off, req.ip comes from the socket, which in supertest is 127.0.0.1
    // So we test the middleware logic by injecting a custom IP via a wrapper
    const a2 = express();
    a2.use(express.json());
    // Middleware to fake a non-loopback IP
    a2.use((req, _res, next) => {
      Object.defineProperty(req, "ip", { value: "192.168.1.50", writable: false });
      next();
    });
    a2.use("/internal", internalApiKeysRouter({ pb, masterKeyPath }));

    const res = await request(a2)
      .post("/internal/api-keys")
      .send({ name: "anthropic", plaintext: "sk-123" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("loopback_only");
  });

  it("missing master key file returns 500 with master_key_missing", async () => {
    app = await buildTestApp({ noMasterKey: true });
    const res = await request(app)
      .post("/internal/api-keys")
      .send({ name: "anthropic", plaintext: "sk-123" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("master_key_missing");
  });

  it("bad request body returns 400", async () => {
    app = await buildTestApp();
    const res = await request(app)
      .post("/internal/api-keys")
      .send({ name: "" });
    expect(res.status).toBe(400);
  });
});
