/**
 * Architecture boundary tests for the anyraven-server monorepo.
 *
 * Allowed dependency graph:
 *   frontend-template  (no @anyraven/* imports — standalone Vite project)
 *   shared             (no @anyraven/* imports — foundation layer)
 *   tunnel-manager  ─┐
 *   app-backend    ─┤→ shared only
 *   app-frontend     ─┘
 *   mcp-server         → shared only  (mounted BY dispatch, never imports it)
 *   dispatch           → shared + mcp-server
 *
 * These rules prevent agents from wiring packages in ways that create
 * circular dependencies or break the supervision model.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

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

function anyravenImports(files: string[]): Record<string, string[]> {
  const violations: Record<string, string[]> = {};
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const found = [...content.matchAll(/from ["'](@anyraven\/[^"']+)["']/g)].map(m => m[1]!);
    if (found.length > 0) violations[file] = found;
  }
  return violations;
}

function pkgSrc(name: string) {
  return join(ROOT, "packages", name, "src");
}

// ─── shared ────────────────────────────────────────────────────────────────

describe("shared — foundation, no upward deps", () => {
  it("has no @anyraven/* imports", () => {
    const violations = anyravenImports(walkTs(pkgSrc("shared")));
    expect(violations).toEqual({});
  });
});

// ─── leaf services ─────────────────────────────────────────────────────────

describe("tunnel-manager — leaf service", () => {
  it("does not import @anyraven/dispatch or @anyraven/mcp-server", () => {
    const violations = anyravenImports(walkTs(pkgSrc("tunnel-manager")));
    const forbidden = Object.entries(violations).flatMap(([f, imps]) =>
      imps.filter(i => i === "@anyraven/dispatch" || i === "@anyraven/mcp-server").map(i => `${f}: ${i}`)
    );
    expect(forbidden).toEqual([]);
  });
});

describe("app-backend — leaf service", () => {
  it("does not import @anyraven/dispatch or @anyraven/mcp-server", () => {
    const violations = anyravenImports(walkTs(pkgSrc("app-backend")));
    const forbidden = Object.entries(violations).flatMap(([f, imps]) =>
      imps.filter(i => i === "@anyraven/dispatch" || i === "@anyraven/mcp-server").map(i => `${f}: ${i}`)
    );
    expect(forbidden).toEqual([]);
  });
});

describe("app-frontend — leaf service", () => {
  it("has no @anyraven/* imports", () => {
    const violations = anyravenImports(walkTs(pkgSrc("app-frontend")));
    expect(violations).toEqual({});
  });
});

// ─── mcp-server ─────────────────────────────────────────────────────────────

describe("mcp-server — mounted by dispatch, never imports it", () => {
  it("does not import @anyraven/dispatch", () => {
    const violations = anyravenImports(walkTs(pkgSrc("mcp-server")));
    const forbidden = Object.entries(violations).flatMap(([f, imps]) =>
      imps.filter(i => i === "@anyraven/dispatch").map(i => `${f}: ${i}`)
    );
    expect(forbidden).toEqual([]);
  });
});

// ─── frontend-template ──────────────────────────────────────────────────────

describe("frontend-template — standalone Vite project", () => {
  it("has no @anyraven/* imports", () => {
    const violations = anyravenImports(walkTs(pkgSrc("frontend-template")));
    expect(violations).toEqual({});
  });
});

// ─── dispatch ───────────────────────────────────────────────────────────────

describe("dispatch — orchestrator, allowed to import mcp-server + shared", () => {
  it("does not import tunnel-manager, app-backend, or app-frontend", () => {
    const violations = anyravenImports(walkTs(pkgSrc("dispatch")));
    const forbidden = Object.entries(violations).flatMap(([f, imps]) =>
      imps
        .filter(i => ["@anyraven/tunnel-manager", "@anyraven/app-backend", "@anyraven/app-frontend"].includes(i))
        .map(i => `${f}: ${i}`)
    );
    expect(forbidden).toEqual([]);
  });
});
