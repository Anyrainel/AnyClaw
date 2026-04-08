import sodium from 'libsodium-wrappers';

let ready = false;

export async function initNacl(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

function assertReady(): void {
  if (!ready) throw new Error('call initNacl() first');
}

export interface Keypair {
  pk: Uint8Array;
  sk: Uint8Array;
}

export function generateKeypair(): Keypair {
  assertReady();
  const kp = sodium.crypto_box_keypair();
  return { pk: kp.publicKey, sk: kp.privateKey };
}

export function box(
  plaintext: Uint8Array,
  peerPk: Uint8Array,
  mySk: Uint8Array,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  assertReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(plaintext, nonce, peerPk, mySk);
  return { nonce, ciphertext };
}

export function unbox(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  peerPk: Uint8Array,
  mySk: Uint8Array,
): Uint8Array {
  assertReady();
  return sodium.crypto_box_open_easy(ciphertext, nonce, peerPk, mySk);
}

/**
 * X25519 scalar multiplication. The first argument MUST be a 32-byte scalar
 * (private key); the second a 32-byte public key. The broker, which only
 * holds public keys, cannot derive the true shared secret because it lacks
 * either party's secret scalar — passing two public keys here yields a value
 * that is NOT the real shared secret.
 */
export function deriveShared(sk: Uint8Array, peerPk: Uint8Array): Uint8Array {
  assertReady();
  if (sk.length !== sodium.crypto_scalarmult_SCALARBYTES) {
    throw new Error('first argument must be a 32-byte private key (scalar)');
  }
  if (peerPk.length !== sodium.crypto_scalarmult_BYTES) {
    throw new Error('second argument must be a 32-byte public key');
  }
  return sodium.crypto_scalarmult(sk, peerPk);
}
