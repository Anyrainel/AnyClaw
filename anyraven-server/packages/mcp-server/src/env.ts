import path from "node:path";

export const POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";
export const MCP_PORT = Number(process.env.ANYRAVEN_MCP_PORT ?? 4100);

export function currentPaths() {
  const root = process.env.ANYRAVEN_DATA_ROOT ?? "/data";
  return {
    anyravenDir: path.join(root, ".anyraven"),
    mcpTokens: path.join(root, ".anyraven", "mcp-tokens"),
    pbTokenFile: path.join(root, ".anyraven", "pb-token"),
    devRoot: path.join(root, "dev"),
    prodRoot: path.join(root, "prod"),
    worktreeDir: path.join(root, "dev", ".worktrees"),
    snapshotDir: path.join(root, ".anyraven", "snapshots"),
  };
}
