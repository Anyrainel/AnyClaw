import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The official BIP39 English wordlist (2048 words). Source of truth:
// https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
// SHA-256 of the JSON file is committed alongside as bip39-english.json.sha256.
const __dirname = dirname(fileURLToPath(import.meta.url));
const wordlistRaw = readFileSync(join(__dirname, 'bip39-english.json'), 'utf8');
const wordlist = JSON.parse(wordlistRaw) as string[];

export const BIP39_WORDLIST: readonly string[] = wordlist;

if (BIP39_WORDLIST.length !== 2048) {
  throw new Error(`BIP39 wordlist corrupt: ${BIP39_WORDLIST.length}`);
}

/**
 * Derive a 4-word BIP39 verification code from a shared secret.
 *
 *   code = words(first 44 bits of SHA256(shared_secret))
 *
 * 44 bits / 11 bits-per-word = 4 words. Matches the mobile app's derivation
 * (Plan 5) byte-for-byte. Any divergence breaks pairing.
 */
export function deriveBip39Code(sharedSecret: Uint8Array): string {
  const digest = createHash('sha256').update(sharedSecret).digest(); // 32 bytes
  // Treat the first 6 bytes as a big-endian 48-bit integer, then keep top 44 bits.
  const hi = BigInt('0x' + digest.subarray(0, 6).toString('hex'));
  const top44 = hi >> 4n;
  const words: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const idx = Number((top44 >> BigInt(i * 11)) & 0x7ffn);
    words.push(BIP39_WORDLIST[idx]!);
  }
  return words.join(' ');
}
