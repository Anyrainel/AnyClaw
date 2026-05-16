import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(__dirname, "..", "..", "..", "infra", "scripts", "sync-frontend-template.sh");

describe("sync-frontend-template.sh", () => {
  it("copies the bundled frontend template into a dev workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "anyclaw-template-sync-"));
    const source = join(root, "template");
    const destRoot = join(root, "data");

    execFileSync("mkdir", ["-p", join(source, "src")]);
    writeFileSync(join(source, "package.json"), '{"name":"template"}\n');
    writeFileSync(join(source, "src", "App.tsx"), "export function App() { return null; }\n");

    execFileSync("bash", [script], {
      env: {
        ...process.env,
        DATA_ROOT: destRoot,
        FRONTEND_TEMPLATE_SRC: source,
      },
      stdio: "pipe",
    });

    expect(existsSync(join(destRoot, "dev", "package.json"))).toBe(true);
    expect(existsSync(join(destRoot, "dev", "src", "App.tsx"))).toBe(true);
    expect(existsSync(join(destRoot, "dev", ".git"))).toBe(true);
  });
});
