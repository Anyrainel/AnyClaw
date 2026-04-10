import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';

async function main() {
  const cfg = loadConfig();
  await runMigrations(cfg.databaseUrl);
  const app = await buildApp(cfg);
  await app.listen({ host: cfg.host, port: cfg.port });
  app.log.info({ port: cfg.port }, 'broker listening');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
