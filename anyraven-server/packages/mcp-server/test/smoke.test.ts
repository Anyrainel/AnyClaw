import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";

describe("package smoke", () => {
  it("exports mountMcp", () => {
    expect(typeof pkg.mountMcp).toBe("function");
  });
});
