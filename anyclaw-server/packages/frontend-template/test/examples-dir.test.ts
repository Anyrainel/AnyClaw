import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXAMPLES_DIR = join(__dirname, "..", "src", "_examples");

describe("_examples directory", () => {
  it("contains a README.md explaining the directory purpose", () => {
    const readmePath = join(EXAMPLES_DIR, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("Read-only reference files");
  });

  it("contains a .gitkeep file", () => {
    expect(existsSync(join(EXAMPLES_DIR, ".gitkeep"))).toBe(true);
  });

  it("contains welcome.tsx as the canonical example", () => {
    const welcomePath = join(EXAMPLES_DIR, "welcome.tsx");
    expect(existsSync(welcomePath)).toBe(true);
    const content = readFileSync(welcomePath, "utf-8");
    expect(content).toContain("Welcome to AnyClaw");
    expect(content).toContain("usePreferences");
  });
});
