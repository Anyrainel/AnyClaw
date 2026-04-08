import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate.js';

let container: StartedPostgreSqlContainer | null = null;
let url: string | null = null;

export async function startPg(): Promise<string> {
  if (url) return url;
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  url = container.getConnectionUri();
  await runMigrations(url);
  return url;
}

export async function stopPg(): Promise<void> {
  if (container) { await container.stop(); container = null; url = null; }
}

export async function resetPg(): Promise<void> {
  if (!url) return;
  const sql = postgres(url, { max: 1 });
  try {
    await sql`TRUNCATE users, oauth_accounts, sessions, servers, server_tokens, device_keys, rate_limit_buckets RESTART IDENTITY CASCADE`;
  } finally {
    await sql.end();
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    // Lightweight check: try to start a container with a tiny timeout. If
    // Docker isn't installed/running, this throws synchronously or quickly.
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
