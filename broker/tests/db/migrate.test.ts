import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { startPg, stopPg, isDockerAvailable } from '../helpers/pg.js';

const dockerOk = await isDockerAvailable();
const d = dockerOk ? describe : describe.skip;

d('migrations', () => {
  let url: string;
  beforeAll(async () => { url = await startPg(); });
  afterAll(async () => { await stopPg(); });

  it('creates all seven tables', async () => {
    const sql = postgres(url, { max: 1 });
    try {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' ORDER BY table_name`;
      const names = rows.map(r => r.table_name);
      expect(names).toEqual(expect.arrayContaining([
        'users','oauth_accounts','sessions','servers','server_tokens','device_keys','rate_limit_buckets','schema_migrations',
      ]));
    } finally { await sql.end(); }
  });

  it('is idempotent', async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    const applied = await runMigrations(url);
    expect(applied).toEqual([]);
  });
});
