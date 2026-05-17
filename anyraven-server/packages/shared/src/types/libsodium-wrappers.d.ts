declare module 'libsodium-wrappers' {
  export function ready(): Promise<void>;
  export function crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  export function crypto_box_easy(message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
  export function crypto_box_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
  export function crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  export function crypto_secretbox_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  export function randombytes_buf(length: number): Uint8Array;
  export function crypto_generichash(length: number, message: Uint8Array): Uint8Array;
  export function crypto_pwhash(length: number, password: Uint8Array, salt: Uint8Array, opsLimit: number, memLimit: number, algorithm: number): Uint8Array;
  export function crypto_sign_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  export function crypto_sign_detached(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
  export function crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
  export const crypto_pwhash_OPSLIMIT_INTERACTIVE: number;
  export const crypto_pwhash_MEMLIMIT_INTERACTIVE: number;
  export const crypto_pwhash_ALG_DEFAULT: number;
  export const crypto_box_NONCEBYTES: number;
}
