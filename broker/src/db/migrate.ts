import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // Bootstrap the migrations table if absent (idempotent).
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    const dir = join(__dirname, 'migrations');
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      const already = await sql`SELECT 1 FROM schema_migrations WHERE filename = ${file}`;
      if (already.length > 0) continue;
      const body = readFileSync(join(dir, file), 'utf8');
      await sql.begin(async tx => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
  runMigrations(url).then(a => { console.log('applied:', a); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
