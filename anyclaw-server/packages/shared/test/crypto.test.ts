import { describe, it, expect, beforeAll } from "vitest";
import {
  initCrypto,
  generateKeyPair,
  encrypt,
  decrypt,
  type KeyPair,
} from "../src/crypto.js";

describe("crypto (NaCl box)", () => {
  beforeAll(async () => { await initCrypto(); });

  it("generates a 32-byte public/secret keypair", () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.secretKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.secretKey.length).toBe(32);
  });

  it("encrypts then decrypts a round trip between two keypairs", () => {
    const alice: KeyPair = generateKeyPair();
    const bob: KeyPair = generateKeyPair();
    const msg = new TextEncoder().encode("hello anyclaw");

    const box = encrypt(msg, bob.publicKey, alice.secretKey);
    expect(box.ciphertext).toBeInstanceOf(Uint8Array);
    expect(box.nonce.length).toBe(24);
    expect(box.ciphertext).not.toEqual(msg);

    const plain = decrypt(box, alice.publicKey, bob.secretKey);
    expect(new TextDecoder().decode(plain)).toBe("hello anyclaw");
  });

  it("throws on tampered ciphertext", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const box = encrypt(new TextEncoder().encode("secret"), b.publicKey, a.secretKey);
    box.ciphertext[0] = box.ciphertext[0]! ^ 0xff;
    expect(() => decrypt(box, a.publicKey, b.secretKey)).toThrow();
  });
});
