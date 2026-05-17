import { describe, it, expect } from "vitest";
import { ToolError } from "../src/errors.js";
import { withErrorHandling } from "../src/tools/register.js";

describe("withErrorHandling", () => {
  it("passes through success", async () => {
    const h = withErrorHandling(async (x: number) => ({
      content: [{ type: "text" as const, text: String(x) }],
      structuredContent: { x },
    }));
    const out = await h(42);
    expect(out.isError).toBeUndefined();
    expect(out.structuredContent).toEqual({ x: 42 });
  });
  it("converts ToolError to isError result", async () => {
    const h = withErrorHandling(async () => {
      throw new ToolError("nope", { k: 1 });
    });
    const out = await h();
    expect(out.isError).toBe(true);
    expect(out.content[0]).toMatchObject({ type: "text", text: "nope" });
    expect(out.content[1]).toMatchObject({ type: "text" });
    expect(JSON.parse((out.content[1] as any).text)).toEqual({ k: 1 });
  });
  it("converts unknown throw to internal error", async () => {
    const h = withErrorHandling(async () => {
      throw new Error("boom");
    });
    const out = await h();
    expect(out.isError).toBe(true);
    expect((out.content[0] as any).text).toContain("Internal error: boom");
  });
});
