import { z } from "zod";
import type PocketBase from "pocketbase";
import { withErrorHandling } from "./register.js";
import { getPocketBaseAdmin, withPbRetry } from "../pocketbase-client.js";

export const listVersionsInput = z.object({
  limit: z.number().int().min(1).max(100).default(10),
});
export const listVersionsOutput = z.object({
  versions: z.array(z.object({
    version: z.string(),
    description: z.string(),
    timestamp: z.string(),
    gitCommit: z.string(),
    dbSnapshotId: z.string().nullable(),
  })),
});

export function makeListVersionsHandler(pbFactory: () => PocketBase = getPocketBaseAdmin) {
  return withErrorHandling(async (input: z.infer<typeof listVersionsInput>) => {
    const rows = await withPbRetry(() =>
      pbFactory().collection("_versions").getList(1, input.limit, { sort: "-created" })
    );
    const versions = rows.items.map((r: any) => ({
      version: r.version,
      description: r.description,
      timestamp: r.created,
      gitCommit: r.gitCommit,
      dbSnapshotId: r.dbSnapshotId ?? null,
    }));
    return {
      content: [{ type: "text" as const, text: `Found ${versions.length} versions` }],
      structuredContent: { versions },
    };
  });
}

export function registerListVersions(server: any) {
  server.registerTool(
    "anyraven_list_versions",
    { title: "List Versions", description: "Show deployment history.", inputSchema: listVersionsInput, outputSchema: listVersionsOutput },
    (input: any) => makeListVersionsHandler()(input),
  );
}
