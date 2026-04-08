import { describe, it, expect, beforeAll } from 'vitest';
import { initNacl, generateKeypair, box, unbox, deriveShared } from '../../src/crypto/nacl.js';

describe('nacl', () => {
  beforeAll(async () => {
    await initNacl();
  });

  it('generates distinct 32-byte keypairs', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(a.pk.length).toBe(32);
    expect(a.sk.length).toBe(32);
    expect(Buffer.from(a.sk).equals(Buffer.from(b.sk))).toBe(false);
  });

  it('box -> unbox round-trip', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const msg = Buffer.from('attack at dawn');
    const { nonce, ciphertext } = box(msg, bob.pk, alice.sk);
    const out = unbox(ciphertext, nonce, alice.pk, bob.sk);
    expect(Buffer.from(out).toString()).toBe('attack at dawn');
  });

  it('shared secrets match both ways (X25519 ECDH)', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const sA = deriveShared(a.sk, b.pk);
    const sB = deriveShared(b.sk, a.pk);
    expect(Buffer.from(sA).equals(Buffer.from(sB))).toBe(true);
  });

  it('broker holding only public keys cannot derive shared secret', () => {
    const mobile = generateKeypair();
    const server = generateKeypair();
    const brokerKnown = { mobile_pk: mobile.pk, server_pk: server.pk };
    // Even if the broker tries to call deriveShared(pk, pk) it must throw,
    // because deriveShared insists on a 32-byte scalar (private key) as arg 1.
    // (Both pks are 32 bytes, so the length check passes — we additionally
    // assert that the result, even if produced, is NOT equal to the real
    // shared secret. In practice sodium will accept any 32-byte scalar so we
    // verify the *security property*: broker output != real shared secret.)
    const real = deriveShared(mobile.sk, server.pk);
    const brokerAttempt = deriveShared(brokerKnown.mobile_pk, brokerKnown.server_pk);
    expect(Buffer.from(brokerAttempt).equals(Buffer.from(real))).toBe(false);
  });

  it('tampered ciphertext fails MAC', () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const { nonce, ciphertext } = box(Buffer.from('x'), b.pk, a.sk);
    ciphertext[0] ^= 0xff;
    expect(() => unbox(ciphertext, nonce, a.pk, b.sk)).toThrow();
  });
});
