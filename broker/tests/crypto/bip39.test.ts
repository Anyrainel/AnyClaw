import { describe, it, expect } from 'vitest';
import { deriveBip39Code, BIP39_WORDLIST } from '../../src/crypto/bip39.js';

describe('bip39 verification code', () => {
  it('has 2048 words', () => {
    expect(BIP39_WORDLIST.length).toBe(2048);
  });

  it('returns 4 words', () => {
    const secret = new Uint8Array(32).fill(0);
    const code = deriveBip39Code(secret);
    expect(code.split(' ')).toHaveLength(4);
  });

  it('is deterministic', () => {
    const s = new Uint8Array(32).fill(7);
    expect(deriveBip39Code(s)).toBe(deriveBip39Code(s));
  });

  it('differs for different secrets', () => {
    const a = deriveBip39Code(new Uint8Array(32).fill(1));
    const b = deriveBip39Code(new Uint8Array(32).fill(2));
    expect(a).not.toBe(b);
  });

  it('all output words are in the wordlist', () => {
    const code = deriveBip39Code(new Uint8Array(32));
    for (const w of code.split(' ')) expect(BIP39_WORDLIST).toContain(w);
  });

  it('golden vector: all-zero secret', () => {
    expect(deriveBip39Code(new Uint8Array(32))).toBe('grid duck problem valid');
  });

  it('golden vector: all-ones secret', () => {
    expect(deriveBip39Code(new Uint8Array(32).fill(1))).toBe('index hidden patient easily');
  });

  it('golden vector: all-twos secret', () => {
    expect(deriveBip39Code(new Uint8Array(32).fill(2))).toBe('intact design unfair denial');
  });

  it('golden vector: all-sevens secret', () => {
    expect(deriveBip39Code(new Uint8Array(32).fill(7))).toBe('entry lock toe organ');
  });
});
