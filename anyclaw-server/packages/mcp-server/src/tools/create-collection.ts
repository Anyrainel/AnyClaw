import { z } from "zod";
import { createRequire } from "node:module";
import type PocketBase from "pocketbase";
import { withErrorHandling } from "./register.js";
import { ToolError } from "../errors.js";
import { getPocketBaseAdmin } from "../pocketbase-client.js";
import type { SnapshotManagerLike } from "./snapshot-db.js";

export const createCollectionInput = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: z.enum(["base", "auth", "view"]).default("base"),
  fields: z.array(z.object({
    name: z.string(),
    type: z.enum(["text","number","bool","email","url","date","select","json","file","relation","editor"]),
    required: z.boolean().default(false),
    options: z.record(z.unknown()).optional(),
  })).min(1),
  listRule:   z.string().nullable().optional(),
  viewRule:   z.string().nullable().optional(),
  createRule: z.string().nullable().optional(),
  updateRule: z.string().nullable().optional(),
  deleteRule: z.string().nullable().optional(),
});

export const createCollectionOutput = z.object({
  collectionId: z.string(),
  collectionName: z.string(),
  fieldsCreated: z.number(),
  snapshotId: z.string(),
});

const requireShared = createRequire(import.meta.url);
const defaultSnap: () => SnapshotManagerLike = () =>
  (requireShared("@anyclaw/shared") as any).snapshotManager;

export function makeCreateCollectionHandler(
  snapFactory: () => SnapshotManagerLike = defaultSnap,
  pbFactory: () => PocketBase = getPocketBaseAdmin,
) {
  return withErrorHandling(async (input: z.infer<typeof createCollectionInput>) => {
    if (input.name.startsWith("_")) {
      throw new ToolError("Collection names starting with '_' are reserved for AnyClaw infrastructure");
    }
    const snap = await snapFactory().create(`pre-schema-${input.name}-${Date.now()}`);
    const created = await pbFactory().collections.create({
      name: input.name,
      type: input.type,
      schema: input.fields.map(f => ({
        name: f.name, type: f.type, required: f.required, options: f.options ?? {},
      })),
      listRule:   input.listRule   ?? null,
      viewRule:   input.viewRule   ?? null,
      createRule: input.createRule ?? null,
      updateRule: input.updateRule ?? null,
      deleteRule: input.deleteRule ?? null,
    } as any);
    return {
      content: [{ type: "text" as const, text: `Created collection '${input.name}' with ${input.fields.length} fields (snapshot: ${snap.snapshotId})` }],
      structuredContent: {
        collectionId: (created as any).id,
        collectionName: input.name,
        fieldsCreated: input.fields.length,
        snapshotId: snap.snapshotId,
      },
    };
  });
}

export function registerCreateCollection(server: any) {
  server.registerTool(
    "anyclaw_create_collection",
    {
      title: "Create Collection",
      description: "Create a new PocketBase collection. Automatically snapshots the database before the schema change.",
      inputSchema: createCollectionInput,
      outputSchema: createCollectionOutput,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    (input: any) => makeCreateCollectionHandler()(input),
  );
}
