import { describe, it, expect } from "vitest";
describe("dispatch package Plan 3 deps", () => {
  it("resolves ws, zod, simple-git, @anyraven/mcp-server, @anyraven/shared", async () => {
    await expect(import("ws")).resolves.toBeDefined();
    await expect(import("zod")).resolves.toBeDefined();
    await expect(import("simple-git")).resolves.toBeDefined();
    await expect(import("@anyraven/shared")).resolves.toBeDefined();
    await expect(import("@anyraven/mcp-server")).resolves.toBeDefined();
  });
});
