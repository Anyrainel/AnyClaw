import { SignJWT, jwtVerify } from 'jose';

export interface JwtConfig {
  secret: string;
  accessTtlSeconds: number;
}

function key(cfg: JwtConfig): Uint8Array {
  return new TextEncoder().encode(cfg.secret);
}

export async function mintAccess(
  cfg: JwtConfig,
  userId: string,
  sessionId: string,
): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${cfg.accessTtlSeconds}s`)
    .setIssuer('anyclaw-broker')
    .setAudience('anyclaw-mobile')
    .sign(key(cfg));
}

export async function verifyAccess(
  cfg: JwtConfig,
  token: string,
): Promise<{ sub: string; sid: string }> {
  const { payload } = await jwtVerify(token, key(cfg), {
    issuer: 'anyclaw-broker',
    audience: 'anyclaw-mobile',
  });
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('invalid jwt claims');
  }
  return { sub: payload.sub, sid: payload.sid };
}
