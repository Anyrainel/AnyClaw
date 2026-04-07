import sodium from "libsodium-wrappers";

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface SealedBox {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

let ready = false;

export async function initCrypto(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

function ensureReady(): void {
  if (!ready) {
    throw new Error("crypto: call initCrypto() before use");
  }
}

export function generateKeyPair(): KeyPair {
  ensureReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

export function encrypt(
  message: Uint8Array,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
): SealedBox {
  ensureReady();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    message,
    nonce,
    recipientPublicKey,
    senderSecretKey,
  );
  return { nonce, ciphertext };
}

export function decrypt(
  box: SealedBox,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array,
): Uint8Array {
  ensureReady();
  return sodium.crypto_box_open_easy(
    box.ciphertext,
    box.nonce,
    senderPublicKey,
    recipientSecretKey,
  );
}
