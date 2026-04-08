import { z } from "zod";
import { createRequire } from "node:module";
import { withErrorHandling } from "./register.js";

export type SnapshotManagerLike = {
  create(label: string): Promise<{ snapshotId: string; sizeBytes: number; path: string }>;
};

export const snapshotDbInput = z.object({
  label: z.string().min(3).describe("Short label, e.g. 'before-mood-data-migration'"),
});
export const snapshotDbOutput = z.object({
  snapshotId: z.string(),
  sizeBytes: z.number(),
  path: z.string(),
});

const requireShared = createRequire(import.meta.url);
const defaultMgr: () => SnapshotManagerLike = () => {
  // Lazy import to keep @anyclaw/shared optional for unit tests.
  const mod = requireShared("@anyclaw/shared") as { snapshotManager: SnapshotManagerLike };
  return mod.snapshotManager;
};

export function makeSnapshotDbHandler(factory: () => SnapshotManagerLike = defaultMgr) {
  return withErrorHandling(async (input: z.infer<typeof snapshotDbInput>) => {
    const snap = await factory().create(input.label);
    return {
      content: [{ type: "text" as const, text: `Snapshot created: ${snap.snapshotId} (${snap.sizeBytes} bytes)` }],
      structuredContent: snap,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerSnapshotDb(
  server: any,
  factory: () => SnapshotManagerLike = defaultMgr,
) {
  const handler = makeSnapshotDbHandler(factory);
  server.registerTool(
    "anyclaw_snapshot_db",
    {
      title: "Snapshot Database",
      description: "Create a compressed SQLite snapshot. Called automatically before schema migrations.",
      inputSchema: snapshotDbInput,
      outputSchema: snapshotDbOutput,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input: any) => handler(input),
  );
}
