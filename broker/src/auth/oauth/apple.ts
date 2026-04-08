import { SignJWT, importPKCS8, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AppleConfig {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  redirectUri: string;
}

export interface AppleProfile {
  sub: string;
  email: string | null;
  /** present only on the FIRST login per Apple's quirk; null thereafter. */
  nameFromCallback: string | null;
}

let JWKS: JWTVerifyGetKey = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export function setAppleJwks(fn: JWTVerifyGetKey): void {
  JWKS = fn;
}

export async function signClientSecret(cfg: AppleConfig): Promise<string> {
  const key = await importPKCS8(cfg.privateKeyPem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('https://appleid.apple.com')
    .setSubject(cfg.clientId)
    .sign(key);
}

export function buildAuthUrl(cfg: AppleConfig, state: string): string {
  const u = new URL('https://appleid.apple.com/auth/authorize');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'name email');
  u.searchParams.set('response_mode', 'form_post');
  u.searchParams.set('state', state);
  return u.toString();
}

/**
 * Apple returns name+email ONLY on the first authorization callback. The
 * `user` form field carries the name as JSON; the id_token carries only `sub`
 * + `email` thereafter. Callers must persist name/email on first-login and
 * never overwrite with the null values returned on subsequent logins.
 */
export async function exchangeCode(
  cfg: AppleConfig,
  code: string,
  userFormField: string | null,
): Promise<AppleProfile> {
  const clientSecret = await signClientSecret(cfg);
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`apple token exchange failed: ${res.status}`);
  const data = (await res.json()) as { id_token: string };
  const { payload } = await jwtVerify(data.id_token, JWKS, {
    issuer: 'https://appleid.apple.com',
    audience: cfg.clientId,
  });

  let nameFromCallback: string | null = null;
  if (userFormField) {
    try {
      const parsed = JSON.parse(userFormField) as {
        name?: { firstName?: string; lastName?: string };
      };
      const fn = parsed.name?.firstName ?? '';
      const ln = parsed.name?.lastName ?? '';
      const full = `${fn} ${ln}`.trim();
      nameFromCallback = full.length > 0 ? full : null;
    } catch {
      /* ignore malformed */
    }
  }

  return {
    sub: String(payload.sub),
    email: (payload['email'] as string | undefined) ?? null,
    nameFromCallback,
  };
}
