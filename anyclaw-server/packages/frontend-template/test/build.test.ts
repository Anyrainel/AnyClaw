import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

describe("frontend-template build", () => {
  it("vite build produces dist/index.html", () => {
    const pkgDir = join(__dirname, "..");
    execSync("npx vite build", { cwd: pkgDir, stdio: "inherit" });
    expect(existsSync(join(pkgDir, "dist", "index.html"))).toBe(true);
  });
}, { timeout: 60000 });
