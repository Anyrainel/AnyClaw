import sodium from "libsodium-wrappers";
import {
  initCrypto,
  generatePairingKeypair,
  verificationCode,
  encryptJSON,
  decryptJSON,
} from "../crypto";
import {
  storePairingKeys,
  loadPairingKeys,
} from "../crypto-storage";
import { BIP39_ENGLISH } from "../bip39-english";

// Mock expo-secure-store
const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete mockStore[key];
  }),
}));

beforeAll(async () => {
  await initCrypto();
});

beforeEach(() => {
  // Clear mock store
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key];
  }
});

describe("encryptJSON / decryptJSON", () => {
  test("round-trip an object with nested fields", async () => {
    const alice = sodium.crypto_box_keypair();
    const bob = sodium.crypto_box_keypair();

    const original = {
      name: "test",
      nested: { count: 42, tags: ["a", "b"] },
    };

    const envelope = encryptJSON(original, bob.publicKey, alice.privateKey);
    const decrypted = decryptJSON<typeof original>(
      envelope,
      alice.publicKey,
      bob.privateKey
    );

    expect(decrypted).toEqual(original);
  });

  test("tampered ciphertext throws", async () => {
    const alice = sodium.crypto_box_keypair();
    const bob = sodium.crypto_box_keypair();

    const envelope = encryptJSON({ secret: true }, bob.publicKey, alice.privateKey);

    // Tamper with one byte
    const tampered = { ...envelope };
    const ciphertextBytes = sodium.from_base64(tampered.ciphertext);
    ciphertextBytes[0] ^= 0xff;
    tampered.ciphertext = sodium.to_base64(ciphertextBytes);

    expect(() =>
      decryptJSON(tampered, alice.publicKey, bob.privateKey)
    ).toThrow();
  });
});

describe("verificationCode", () => {
  test("deterministic — same inputs produce the same 4 words", async () => {
    const alice = sodium.crypto_box_keypair();
    const bob = sodium.crypto_box_keypair();

    const code1 = verificationCode(alice.publicKey, bob.publicKey);
    const code2 = verificationCode(alice.publicKey, bob.publicKey);

    expect(code1).toEqual(code2);
  });

  test("swapping pks produces a different code", async () => {
    const alice = sodium.crypto_box_keypair();
    const bob = sodium.crypto_box_keypair();

    const code1 = verificationCode(alice.publicKey, bob.publicKey);
    const code2 = verificationCode(bob.publicKey, alice.publicKey);

    expect(code1).not.toEqual(code2);
  });

  test("returns exactly 4 words, all present in the wordlist", async () => {
    const alice = sodium.crypto_box_keypair();
    const bob = sodium.crypto_box_keypair();

    const code = verificationCode(alice.publicKey, bob.publicKey);

    expect(code).toHaveLength(4);
    for (const word of code) {
      expect(BIP39_ENGLISH).toContain(word);
    }
  });
});

describe("generatePairingKeypair", () => {
  test("produces 32-byte keys and two calls produce different keys", async () => {
    const kp1 = generatePairingKeypair();
    const kp2 = generatePairingKeypair();

    expect(kp1.publicKey).toHaveLength(32);
    expect(kp1.secretKey).toHaveLength(32);
    expect(kp2.publicKey).toHaveLength(32);
    expect(kp2.secretKey).toHaveLength(32);

    // Different keys
    expect(sodium.to_base64(kp1.publicKey)).not.toEqual(
      sodium.to_base64(kp2.publicKey)
    );
  });
});

describe("crypto-storage", () => {
  test("loadPairingKeys after storePairingKeys round-trips keys", async () => {
    const kp = sodium.crypto_box_keypair();
    const serverPk = sodium.crypto_box_keypair().publicKey;

    await storePairingKeys("server-1", {
      publicKey: kp.publicKey,
      secretKey: kp.privateKey,
      serverPublicKey: serverPk,
    });

    const loaded = await loadPairingKeys("server-1");
    expect(loaded).not.toBeNull();
    expect(sodium.to_base64(loaded!.publicKey)).toEqual(
      sodium.to_base64(kp.publicKey)
    );
    expect(sodium.to_base64(loaded!.secretKey)).toEqual(
      sodium.to_base64(kp.privateKey)
    );
    expect(sodium.to_base64(loaded!.serverPublicKey)).toEqual(
      sodium.to_base64(serverPk)
    );
  });
});
