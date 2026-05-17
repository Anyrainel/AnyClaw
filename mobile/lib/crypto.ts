import sodium from "libsodium-wrappers";
import { BIP39_ENGLISH } from "./bip39-english";

export interface Envelope {
  ciphertext: string; // base64
  nonce: string; // base64
}

let _ready = false;

/**
 * Initialize libsodium. Idempotent.
 */
export async function initCrypto(): Promise<void> {
  if (_ready) return;
  await sodium.ready;
  _ready = true;
}

/**
 * Generate a new X25519 keypair for pairing.
 */
export function generatePairingKeypair(): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/**
 * Deterministic 4-word BIP39 verification code from two public keys.
 * Uses crypto_generichash(8, clientPk || serverPk) with key "anyraven-pair".
 */
export function verificationCode(
  clientPk: Uint8Array,
  serverPk: Uint8Array
): string[] {
  const combined = new Uint8Array(clientPk.length + serverPk.length);
  combined.set(clientPk, 0);
  combined.set(serverPk, clientPk.length);

  const hash = sodium.crypto_generichash(
    8,
    combined,
    sodium.from_string("anyraven-pair")
  );

  // Read 4 uint16 values from 8 bytes, each mod 2048 to index into BIP39
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    const val = view.getUint16(i * 2, true) % 2048;
    words.push(BIP39_ENGLISH[val]);
  }
  return words;
}

/**
 * Encrypt a JSON-serializable value using crypto_box_easy.
 */
export function encryptJSON<T>(
  plain: T,
  theirPk: Uint8Array,
  mySk: Uint8Array
): Envelope {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const message = sodium.from_string(JSON.stringify(plain));
  const ciphertext = sodium.crypto_box_easy(message, nonce, theirPk, mySk);
  return {
    ciphertext: sodium.to_base64(ciphertext),
    nonce: sodium.to_base64(nonce),
  };
}

/**
 * Decrypt an envelope and parse as JSON.
 */
export function decryptJSON<T>(
  envelope: Envelope,
  theirPk: Uint8Array,
  mySk: Uint8Array
): T {
  const ciphertext = sodium.from_base64(envelope.ciphertext);
  const nonce = sodium.from_base64(envelope.nonce);
  const plaintext = sodium.crypto_box_open_easy(
    ciphertext,
    nonce,
    theirPk,
    mySk
  );
  if (plaintext === false) {
    throw new Error("Decryption failed");
  }
  return JSON.parse(sodium.to_string(plaintext)) as T;
}
