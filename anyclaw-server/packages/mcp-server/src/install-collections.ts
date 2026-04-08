import type PocketBase from "pocketbase";

type Field = {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
};
type CollSpec = {
  name: string;
  type?: "base" | "auth";
  schema: Field[];
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
  indexes?: string[];
};

const ADMIN_ONLY = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

const TASKS: CollSpec = {
  name: "_tasks",
  schema: [
    { name: "taskId", type: "text", required: true, options: { max: 64 } },
    { name: "request", type: "text", required: true },
    {
      name: "state",
      type: "select",
      required: true,
      options: {
        maxSelect: 1,
        values: ["queued", "clarifying", "working", "deploying", "done", "failed", "cancelled"],
      },
    },
    { name: "agentType", type: "text", required: true },
    { name: "checkpoint", type: "json" },
    { name: "error", type: "text" },
    { name: "worktreePath", type: "text" },
    { name: "startedAt", type: "date" },
    { name: "finishedAt", type: "date" },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_tasks_taskid ON _tasks (taskId)"],
  ...ADMIN_ONLY,
};

const AGENT_MESSAGES: CollSpec = {
  name: "_agent_messages",
  schema: [
    { name: "taskId", type: "text", required: true },
    {
      name: "direction",
      type: "select",
      required: true,
      options: { maxSelect: 1, values: ["agent_to_user", "user_to_agent"] },
    },
    {
      name: "type",
      type: "select",
      required: true,
      options: { maxSelect: 1, values: ["question", "answer", "progress", "deploy_event"] },
    },
    { name: "content", type: "text", required: true },
    { name: "options", type: "json" },
    {
      name: "phase",
      type: "select",
      options: { maxSelect: 1, values: ["clarifying", "working", "deploying"] },
    },
    { name: "percent", type: "number" },
    { name: "questionId", type: "text" },
    { name: "answeredAt", type: "date" },
  ],
  indexes: ["CREATE INDEX idx_msgs_task ON _agent_messages (taskId)"],
  ...ADMIN_ONLY,
};

const VERSIONS: CollSpec = {
  name: "_versions",
  schema: [
    { name: "version", type: "text", required: true, options: { max: 32 } },
    { name: "description", type: "text", required: true, options: { min: 10 } },
    { name: "gitCommit", type: "text", required: true, options: { max: 64 } },
    { name: "gitTag", type: "text" },
    { name: "dbSnapshotId", type: "text" },
    { name: "deployedBy", type: "text" },
    { name: "artifacts", type: "json" },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_versions_version ON _versions (version)"],
  ...ADMIN_ONLY,
};

const USER_PREFS: CollSpec = {
  name: "_user_preferences",
  schema: [
    { name: "key", type: "text", required: true },
    { name: "value", type: "json" },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_prefs_key ON _user_preferences (key)"],
  ...ADMIN_ONLY,
};

const API_KEYS: CollSpec = {
  name: "_api_keys",
  schema: [
    { name: "name", type: "text", required: true },
    { name: "ciphertext", type: "text", required: true },
    { name: "nonce", type: "text", required: true },
    { name: "createdByTask", type: "text" },
  ],
  indexes: ["CREATE UNIQUE INDEX idx_keys_name ON _api_keys (name)"],
  ...ADMIN_ONLY,
};

const DEPLOYMENTS: CollSpec = {
  name: "_deployments",
  schema: [
    { name: "version_tag", type: "text", required: true, options: { max: 64 } },
    { name: "description", type: "text", required: true },
    { name: "created_at", type: "autodate" },
    { name: "git_sha", type: "text" },
    { name: "db_snapshot_id", type: "text" },
  ],
  indexes: ["CREATE INDEX idx_deployments_created ON _deployments (created_at)"],
  ...ADMIN_ONLY,
};

const ALL: CollSpec[] = [TASKS, AGENT_MESSAGES, VERSIONS, USER_PREFS, API_KEYS, DEPLOYMENTS];

export async function ensureInternalCollections(pb: PocketBase): Promise<void> {
  for (const spec of ALL) {
    try {
      await pb.collections.getOne(spec.name);
    } catch (e: unknown) {
      const status = (e as { status?: number } | null)?.status;
      if (status !== 404) throw e;
      await pb.collections.create(spec as never);
    }
  }
}
