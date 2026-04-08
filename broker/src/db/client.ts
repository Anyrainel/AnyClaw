import postgres from 'postgres';
import type { Config } from '../config.js';

export type DB = ReturnType<typeof postgres>;

export function createDb(cfg: Pick<Config, 'databaseUrl'>): DB {
  return postgres(cfg.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    prepare: true,
  });
}
