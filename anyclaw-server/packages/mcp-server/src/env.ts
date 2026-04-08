import path from "node:path";

export const POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";
export const MCP_PORT = Number(process.env.ANYCLAW_MCP_PORT ?? 4100);

export function currentPaths() {
  const root = process.env.ANYCLAW_DATA_ROOT ?? "/data";
  return {
    anyclawDir: path.join(root, ".anyclaw"),
    mcpTokens: path.join(root, ".anyclaw", "mcp-tokens"),
    pbTokenFile: path.join(root, ".anyclaw", "pb-token"),
    devRoot: path.join(root, "dev"),
    prodRoot: path.join(root, "prod"),
    worktreeDir: path.join(root, "dev", ".worktrees"),
    snapshotDir: path.join(root, ".anyclaw", "snapshots"),
  };
}
