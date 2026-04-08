import { generateKeyPair, SignJWT, exportJWK, type KeyLike, type JWK } from 'jose';

export interface LocalKey {
  privateKey: KeyLike;
  publicKey: KeyLike;
  kid: string;
  alg: 'RS256' | 'ES256';
}

export async function makeRsaKey(kid = 'test-rsa'): Promise<LocalKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return { privateKey, publicKey, kid, alg: 'RS256' };
}

export async function makeEcKey(kid = 'test-ec'): Promise<LocalKey> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  return { privateKey, publicKey, kid, alg: 'ES256' };
}

export async function jwksJson(key: LocalKey): Promise<{ keys: JWK[] }> {
  const jwk = await exportJWK(key.publicKey);
  jwk.kid = key.kid;
  jwk.alg = key.alg;
  jwk.use = 'sig';
  return { keys: [jwk] };
}

export async function signIdToken(
  key: LocalKey,
  claims: Record<string, unknown>,
  issuer: string,
  audience: string,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: key.alg, kid: key.kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(String(claims['sub'] ?? ''))
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key.privateKey);
}

/** A locally-generated ES256 PKCS#8 PEM for use as an Apple client-secret key. */
export async function makeApplePkcs8(): Promise<{ pem: string; key: LocalKey }> {
  const key = await makeEcKey('apple-kid');
  const { exportPKCS8 } = await import('jose');
  const pem = await exportPKCS8(key.privateKey);
  return { pem, key };
}
