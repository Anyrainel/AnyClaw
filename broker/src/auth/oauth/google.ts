import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleProfile {
  sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

// JWKS is module-level so production reuses cached keys, but tests inject
// their own via setGoogleJwks so jwtVerify runs against a local keypair.
let JWKS: JWTVerifyGetKey = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function setGoogleJwks(fn: JWTVerifyGetKey): void {
  JWKS = fn;
}

export function buildAuthUrl(cfg: GoogleConfig, state: string, challenge: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  verifier: string,
): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const data = (await res.json()) as { id_token: string };
  const { payload } = await jwtVerify(data.id_token, JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: cfg.clientId,
  });
  return {
    sub: String(payload.sub),
    email: (payload['email'] as string | undefined) ?? null,
    name: (payload['name'] as string | undefined) ?? null,
    picture: (payload['picture'] as string | undefined) ?? null,
  };
}
