import { describe, it, expect } from "vitest";
describe("dispatch package Plan 3 deps", () => {
  it("resolves ws, zod, simple-git, @anyclaw/mcp-server, @anyclaw/shared", async () => {
    await expect(import("ws")).resolves.toBeDefined();
    await expect(import("zod")).resolves.toBeDefined();
    await expect(import("simple-git")).resolves.toBeDefined();
    await expect(import("@anyclaw/shared")).resolves.toBeDefined();
    await expect(import("@anyclaw/mcp-server")).resolves.toBeDefined();
  });
});
