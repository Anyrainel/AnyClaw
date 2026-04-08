import { z } from 'zod';

const schema = z.object({
  BROKER_PORT: z.coerce.number().int().positive().default(8080),
  BROKER_HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres://')),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  APPLE_CLIENT_ID: z.string().min(1),
  APPLE_TEAM_ID: z.string().min(1),
  APPLE_KEY_ID: z.string().min(1),
  APPLE_PRIVATE_KEY_PEM: z.string().includes('BEGIN PRIVATE KEY'),
  APPLE_REDIRECT_URI: z.string().url(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_REDIRECT_URI: z.string().url(),
  PROVIDER_TOKEN_ENC_KEY: z.string().min(32),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Config error: ${msg}`);
  }
  const v = parsed.data;
  return {
    port: v.BROKER_PORT,
    host: v.BROKER_HOST,
    logLevel: v.LOG_LEVEL,
    databaseUrl: v.DATABASE_URL,
    jwt: { secret: v.JWT_SECRET, accessTtlSeconds: v.JWT_ACCESS_TTL_SECONDS },
    oauth: {
      google: { clientId: v.GOOGLE_CLIENT_ID, clientSecret: v.GOOGLE_CLIENT_SECRET, redirectUri: v.GOOGLE_REDIRECT_URI },
      apple:  { clientId: v.APPLE_CLIENT_ID, teamId: v.APPLE_TEAM_ID, keyId: v.APPLE_KEY_ID, privateKeyPem: v.APPLE_PRIVATE_KEY_PEM, redirectUri: v.APPLE_REDIRECT_URI },
      github: { clientId: v.GITHUB_CLIENT_ID, clientSecret: v.GITHUB_CLIENT_SECRET, redirectUri: v.GITHUB_REDIRECT_URI },
    },
    providerTokenEncKey: v.PROVIDER_TOKEN_ENC_KEY,
  };
}
