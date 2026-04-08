import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { currentPaths } from "./env.js";

const tokenToTask = new Map<string, string>();

export function __resetTokenRegistryForTests(): void {
  tokenToTask.clear();
}

export function registerTaskToken(taskId: string, token: string): void {
  tokenToTask.set(token, taskId);
  const dir = currentPaths().mcpTokens;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `task-${taskId}.token`);
  fs.writeFileSync(file, token, { mode: 0o640 });
}

export function revokeTaskToken(taskId: string): void {
  for (const [tok, id] of tokenToTask.entries()) {
    if (id === taskId) tokenToTask.delete(tok);
  }
  try {
    fs.unlinkSync(path.join(currentPaths().mcpTokens, `task-${taskId}.token`));
  } catch {
    /* ignore */
  }
}

const TOKEN_KEY = "__anyclawToken";

export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  const tok = m?.[1];
  if (!tok || !tokenToTask.has(tok)) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  (req as unknown as Record<string, string>)[TOKEN_KEY] = tok;
  next();
}

export function resolveTaskFromToken(req: Request): string {
  const tok = (req as unknown as Record<string, string | undefined>)[TOKEN_KEY];
  const id = tok ? tokenToTask.get(tok) : undefined;
  if (!id) throw new Error("token_not_registered");
  return id;
}
