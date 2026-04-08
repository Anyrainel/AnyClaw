import type { Express } from "express";

export type McpContext = Record<string, never>;

export function mountMcp(_app: Express, _ctx: McpContext = {}): void {
  throw new Error("mountMcp not implemented yet");
}
