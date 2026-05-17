/**
 * Architecture boundary tests for the broker.
 *
 * Rules:
 *   - No file imports @anyraven/* packages (broker is standalone)
 *   - src/relay/ is protocol-agnostic: must not import from src/auth/
 *   - src/crypto/ is a pure utility: must not import from src/relay/ or src/auth/
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (extname(full) === ".ts") out.push(full);
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

function filesUnder(subdir: string) {
  return walkTs(join(SRC, subdir));
}

// ─── external package boundaries ────────────────────────────────────────────

describe("broker — standalone, no @anyraven/* imports", () => {
  it("has no @anyraven/* imports anywhere in src/", () => {
    const violations = importsMatching(
      walkTs(SRC),
      /from ["'](@anyraven\/[^"']+)["']/g
    );
    expect(violations).toEqual({});
  });
});

// ─── internal module boundaries ─────────────────────────────────────────────

describe("src/relay — protocol layer, auth-agnostic", () => {
  // relay/client-handler.ts is allowed to import auth/jwt for connection-level
  // token verification (identifying which server a socket belongs to).
  // It must not touch session management, OAuth flows, or Lucia internals.
  it("does not import auth/session, auth/routes, auth/lucia, or auth/oauth", () => {
    const violations = importsMatching(
      filesUnder("relay"),
      /from ["']([^"']*\/auth\/(session|routes|lucia|oauth)[^"']*)["']/g
    );
    expect(violations).toEqual({});
  });
});

describe("src/crypto — pure utility, no upstream deps", () => {
  it("does not import from src/relay/ or src/auth/", () => {
    const relayOrAuth = /from ["']([^"']*\/(relay|auth)\/[^"']*)["']/g;
    const violations = importsMatching(filesUnder("crypto"), relayOrAuth);
    expect(violations).toEqual({});
  });
});
