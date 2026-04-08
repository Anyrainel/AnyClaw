import { randomBytes } from 'node:crypto';
import type { DB } from '../db/client.js';

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  expires_at: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function newOpaque(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface CreateSessionOpts {
  deviceName?: string | null;
  deviceOs?: string | null;
  ip?: string | null;
}

export async function createSession(
  db: DB,
  userId: string,
  opts: CreateSessionOpts = {},
): Promise<SessionRow> {
  const id = newOpaque();
  const refresh = newOpaque();
  const expires = new Date(Date.now() + THIRTY_DAYS_MS);
  const rows = await db<SessionRow[]>`
    INSERT INTO sessions (id, user_id, device_name, device_os, ip_address, refresh_token, expires_at)
    VALUES (${id}, ${userId}, ${opts.deviceName ?? null}, ${opts.deviceOs ?? null}, ${opts.ip ?? null}, ${refresh}, ${expires})
    RETURNING id, user_id, refresh_token, expires_at`;
  const row = rows[0];
  if (!row) throw new Error('createSession: insert returned no row');
  return row;
}

export async function findSessionById(db: DB, id: string): Promise<SessionRow | null> {
  const rows = await db<SessionRow[]>`
    SELECT id, user_id, refresh_token, expires_at FROM sessions
    WHERE id = ${id} AND expires_at > now()`;
  return rows[0] ?? null;
}

export async function findSessionByRefresh(db: DB, refresh: string): Promise<SessionRow | null> {
  const rows = await db<SessionRow[]>`
    SELECT id, user_id, refresh_token, expires_at FROM sessions
    WHERE refresh_token = ${refresh} AND expires_at > now()`;
  return rows[0] ?? null;
}

export async function touchSession(db: DB, id: string): Promise<void> {
  const newExpires = new Date(Date.now() + THIRTY_DAYS_MS);
  await db`UPDATE sessions SET last_active = now(), expires_at = ${newExpires} WHERE id = ${id}`;
}

export async function revokeSession(db: DB, id: string): Promise<void> {
  await db`DELETE FROM sessions WHERE id = ${id}`;
}
