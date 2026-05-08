declare module 'libsodium-wrappers' {
  export const ready: Promise<void>;
  export const crypto_box_NONCEBYTES: number;
  export function crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  export function crypto_box_easy(
    message: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array
  ): Uint8Array;
  export function crypto_box_open_easy(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array
  ): Uint8Array | false;
  export function randombytes_buf(length: number): Uint8Array;
  export function crypto_generichash(
    outputLength: number,
    message: Uint8Array,
    key?: Uint8Array | string
  ): Uint8Array;
  export function from_hex(hex: string): Uint8Array;
  export function to_hex(bytes: Uint8Array): string;
  export function from_base64(base64: string): Uint8Array;
  export function to_base64(bytes: Uint8Array): string;
  export function from_string(str: string): Uint8Array;
  export function to_string(bytes: Uint8Array): string;
}
