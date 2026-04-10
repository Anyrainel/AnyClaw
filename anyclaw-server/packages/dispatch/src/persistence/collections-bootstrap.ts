import type PocketBase from "pocketbase";

const COLLECTIONS = [
  {
    name: "_task_clarifications",
    type: "base",
    schema: [
      { name: "taskId", type: "text", required: true },
      { name: "question", type: "text", required: true },
      { name: "answer", type: "text" },
      {
        name: "status",
        type: "select",
        options: { values: ["pending", "answered", "timed_out"] },
        required: true,
      },
      { name: "created_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_clarif_task ON _task_clarifications (taskId)",
    ],
  },
  {
    name: "_devices",
    type: "base",
    schema: [
      { name: "user_token", type: "text", required: true },
      { name: "expo_push_token", type: "text", required: true },
      {
        name: "platform",
        type: "select",
        options: { values: ["ios", "android"] },
        required: true,
      },
      { name: "created_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_devices_token ON _devices (expo_push_token)",
    ],
  },
  {
    name: "_deployments",
    type: "base",
    schema: [
      { name: "taskId", type: "text", required: true },
      { name: "versionId", type: "text", required: true },
      {
        name: "state",
        type: "select",
        options: {
          values: ["deploying", "deployed", "failed", "rolled_back"],
        },
        required: true,
      },
      { name: "description", type: "text" },
      { name: "error", type: "text" },
      { name: "created_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_deploy_task ON _deployments (taskId)",
    ],
  },
] as const;

export async function ensureDispatchCollections(
  pb: PocketBase,
): Promise<void> {
  const existing = new Set(
    (await pb.collections.getFullList()).map((c) => c.name),
  );
  for (const spec of COLLECTIONS) {
    if (existing.has(spec.name)) continue;
    await pb.collections.create(spec as any);
  }
}
