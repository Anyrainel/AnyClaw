export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GithubProfile {
  sub: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
}

export function buildAuthUrl(cfg: GithubConfig, state: string): string {
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', 'read:user user:email');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(cfg: GithubConfig, code: string): Promise<GithubProfile> {
  const tokRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
    }),
  });
  if (!tokRes.ok) throw new Error(`github token exchange failed: ${tokRes.status}`);
  const { access_token } = (await tokRes.json()) as { access_token: string };

  const h = {
    authorization: `Bearer ${access_token}`,
    'user-agent': 'anyclaw-broker',
    accept: 'application/vnd.github+json',
  };
  const userRes = await fetch('https://api.github.com/user', { headers: h });
  if (!userRes.ok) throw new Error(`github /user failed: ${userRes.status}`);
  const user = (await userRes.json()) as {
    id: number;
    name: string | null;
    avatar_url: string | null;
  };

  const emailsRes = await fetch('https://api.github.com/user/emails', { headers: h });
  if (!emailsRes.ok) throw new Error(`github /user/emails failed: ${emailsRes.status}`);
  const emails = (await emailsRes.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const primary = emails.find((e) => e.primary && e.verified) ?? null;

  return {
    sub: String(user.id),
    email: primary?.email ?? null,
    name: user.name,
    avatar: user.avatar_url,
  };
}
