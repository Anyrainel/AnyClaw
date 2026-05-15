import { describe, it, expect } from "vitest";
import { ensureDispatchCollections } from "../../src/persistence/collections-bootstrap.js";
import { makeFakePb } from "./helpers/fake-pb.js";

describe("ensureDispatchCollections", () => {
  it("creates _task_clarifications, _devices, _deployments when absent", async () => {
    const pb = makeFakePb();
    await ensureDispatchCollections(pb as any);
    const names = (await pb.collections.getFullList())
      .map((c: any) => c.name)
      .sort();
    expect(names).toEqual(["_deployments", "_devices", "_task_clarifications"]);
  });

  it("is idempotent", async () => {
    const pb = makeFakePb();
    await ensureDispatchCollections(pb as any);
    await ensureDispatchCollections(pb as any);
    expect((await pb.collections.getFullList()).length).toBe(3);
  });

  it("_devices schema includes userToken, expoPushToken, platform, created_at", async () => {
    const pb = makeFakePb();
    await ensureDispatchCollections(pb as any);
    const d = (await pb.collections.getFullList()).find(
      (c: any) => c.name === "_devices",
    );
    const fields = (d as any).fields.map((f: any) => f.name).sort();
    expect(fields).toEqual([
      "created_at",
      "expoPushToken",
      "platform",
      "userToken",
    ]);
  });
});
