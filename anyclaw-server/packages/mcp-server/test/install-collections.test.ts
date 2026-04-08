import { describe, it, expect, vi } from "vitest";
import { ensureInternalCollections } from "../src/install-collections.js";

function makePbMock() {
  const existing = new Map<string, any>();
  return {
    existing,
    collections: {
      getOne: vi.fn(async (name: string) => {
        if (!existing.has(name)) throw Object.assign(new Error("404"), { status: 404 });
        return existing.get(name);
      }),
      create: vi.fn(async (spec: any) => {
        existing.set(spec.name, { id: `id-${spec.name}`, ...spec });
        return { id: `id-${spec.name}`, ...spec };
      }),
    },
  };
}

describe("ensureInternalCollections", () => {
  it("creates all six collections on first run", async () => {
    const pb = makePbMock();
    await ensureInternalCollections(pb as any);
    const names = [...pb.existing.keys()].sort();
    expect(names).toEqual([
      "_agent_messages",
      "_api_keys",
      "_deployments",
      "_tasks",
      "_user_preferences",
      "_versions",
    ]);
  });
  it("is idempotent", async () => {
    const pb = makePbMock();
    await ensureInternalCollections(pb as any);
    await ensureInternalCollections(pb as any);
    expect(pb.collections.create).toHaveBeenCalledTimes(6);
  });
  it("_tasks has expected fields", async () => {
    const pb = makePbMock();
    await ensureInternalCollections(pb as any);
    const tasks = pb.existing.get("_tasks");
    const fieldNames = tasks.schema.map((f: any) => f.name).sort();
    expect(fieldNames).toEqual([
      "agentType",
      "checkpoint",
      "error",
      "finishedAt",
      "request",
      "startedAt",
      "state",
      "taskId",
      "worktreePath",
    ]);
  });
});
