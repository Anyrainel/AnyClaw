import { describe, it, expect } from "vitest";
import { NoopResourceLimits } from "../../src/resource-limits/noop.js";
describe("NoopResourceLimits", () => {
  it("prepare returns null, apply/release are no-ops", async () => {
    const r = new NoopResourceLimits();
    expect(await r.prepare("t1", { cpuQuotaPercent: 200, memoryMaxMb: 2048 })).toBeNull();
    await expect(r.apply(1234, "handle")).resolves.toBeUndefined();
    await expect(r.release("handle")).resolves.toBeUndefined();
  });
});
