import { createRequire } from "node:module";
import { z } from "zod";
import { withErrorHandling } from "./register.js";

const require = createRequire(import.meta.url);

export type RollbackManagerLike = {
  run(
    version: string,
  ): Promise<{
    rolledBackTo: string;
    safetySnapshotId: string;
    gitCommit: string;
  }>;
};

export const rollbackInput = z.object({
  version: z.string().describe("Version identifier, e.g. 'v1.2.0'"),
});
export const rollbackOutput = z.object({
  rolledBackTo: z.string(),
  safetySnapshotId: z.string(),
  gitCommit: z.string(),
});

const defaultMgr: () => RollbackManagerLike = () =>
  (require("@anyraven/shared") as any).rollbackManager;

export function makeRollbackHandler(
  factory: () => RollbackManagerLike = defaultMgr,
) {
  return withErrorHandling(
    async (input: z.infer<typeof rollbackInput>) => {
      const r = await factory().run(input.version);
      return {
        content: [
          {
            type: "text" as const,
            text: `Rolled back to ${r.rolledBackTo} (safety snapshot ${r.safetySnapshotId})`,
          },
        ],
        structuredContent: r,
      };
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRollback(
  server: any,
  factory: () => RollbackManagerLike = defaultMgr,
) {
  const handler = makeRollbackHandler(factory);
  server.registerTool(
    "anyraven_rollback",
    {
      title: "Rollback to Version",
      description:
        "Revert production code and database to a specific version. Snapshots current state first.",
      inputSchema: rollbackInput,
      outputSchema: rollbackOutput,
      annotations: { destructiveHint: true },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input: any) => handler(input),
  );
}
