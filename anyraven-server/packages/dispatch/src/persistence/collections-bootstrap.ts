import type PocketBase from "pocketbase";

const COLLECTIONS = [
  {
    name: "_task_clarifications",
    type: "base",
    fields: [
      { name: "taskId", type: "text", required: true },
      { name: "clarificationId", type: "text", required: true },
      { name: "question", type: "text", required: true },
      { name: "answer", type: "text" },
      {
        name: "status",
        type: "select",
        options: { values: ["pending", "answered", "timed_out"] },
        required: true,
      },
      { name: "created_at", type: "autodate", options: { onCreate: true, onUpdate: false } },
    ],
    indexes: [
      "CREATE INDEX idx_clarif_task ON _task_clarifications (taskId)",
    ],
  },
  {
    name: "_devices",
    type: "base",
    fields: [
      { name: "userToken", type: "text", required: true },
      { name: "expoPushToken", type: "text", required: true },
      {
        name: "platform",
        type: "select",
        options: { values: ["ios", "android"] },
        required: true,
      },
      { name: "created_at", type: "autodate", options: { onCreate: true, onUpdate: false } },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_devices_token ON _devices (expoPushToken)",
    ],
  },
  {
    name: "_deployments",
    type: "base",
    fields: [
      { name: "taskId", type: "text" },
      { name: "versionId", type: "text" },
      { name: "version_tag", type: "text", options: { max: 64 } },
      {
        name: "state",
        type: "select",
        options: {
          values: ["deploying", "deployed", "failed", "rolled_back"],
        },
      },
      { name: "description", type: "text" },
      { name: "error", type: "text" },
      { name: "created_at", type: "autodate", options: { onCreate: true, onUpdate: false } },
      { name: "git_sha", type: "text" },
      { name: "db_snapshot_id", type: "text" },
    ],
    indexes: [
      "CREATE INDEX idx_deploy_task ON _deployments (taskId)",
      "CREATE INDEX idx_deployments_created ON _deployments (created_at)",
    ],
  },
] as const;

function toPocketBaseField(field: {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...field.options,
    name: field.name,
    type: field.type,
    required: field.required ?? false,
  };
}

function toPocketBaseCollection(spec: (typeof COLLECTIONS)[number]): Record<string, unknown> {
  return {
    ...spec,
    fields: spec.fields.map(toPocketBaseField),
  };
}

export async function ensureDispatchCollections(
  pb: PocketBase,
): Promise<void> {
  const existing = new Map(
    (await pb.collections.getFullList()).map((c) => [c.name, c]),
  );
  for (const spec of COLLECTIONS) {
    const collection = toPocketBaseCollection(spec);
    const current = existing.get(spec.name);
    if (current) {
      await pb.collections.update(current.id, collection as any);
      continue;
    }
    await pb.collections.create(collection as any);
  }
}
