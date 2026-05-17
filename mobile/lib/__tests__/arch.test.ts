/**
 * Architecture boundary tests for the mobile app.
 *
 * Rules:
 *   - No file imports @anyraven/* packages (mobile is standalone)
 *   - lib/ does not import from app/ (lib must remain framework-agnostic
 *     and usable outside of Expo Router context)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const LIB = join(ROOT, "lib");
const APP = join(ROOT, "app");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (extname(full) === ".ts" || extname(full) === ".tsx") out.push(full);
  }
  return out;
}

function importsMatching(files: string[], pattern: RegExp): Record<string, string[]> {
  const violations: Record<string, string[]> = {};
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const found = [...content.matchAll(pattern)].map(m => m[1]!);
    if (found.length > 0) violations[relative(ROOT, file)] = found;
  }
  return violations;
}

// ─── external package boundaries ────────────────────────────────────────────

describe("mobile — standalone, no @anyraven/* imports", () => {
  it("lib/ has no @anyraven/* imports", () => {
    const violations = importsMatching(
      walkTs(LIB),
      /from ["'](@anyraven\/[^"']+)["']/g
    );
    expect(violations).toEqual({});
  });

  it("app/ has no @anyraven/* imports", () => {
    const violations = importsMatching(
      walkTs(APP),
      /from ["'](@anyraven\/[^"']+)["']/g
    );
    expect(violations).toEqual({});
  });
});

// ─── internal module boundaries ─────────────────────────────────────────────

describe("lib/ — framework-agnostic, must not import from app/", () => {
  it("has no imports from app/ or expo-router navigation", () => {
    // lib/ files must not reach into the Expo Router app/ directory.
    // They may use expo-router types via package import, but not relative
    // paths that cross the lib/→app/ boundary.
    const violations = importsMatching(
      walkTs(LIB),
      /from ["']([^"']*\.\.\/app\/[^"']*)["']/g
    );
    expect(violations).toEqual({});
  });
});
