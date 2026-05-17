import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_PATH = join(__dirname, "..", "..", "..", "scripts", "seed-welcome-collection.js");

describe("seed-welcome-collection.js", () => {
  const src = readFileSync(SCRIPT_PATH, "utf-8");

  it("defines a tips collection with the correct schema fields", () => {
    expect(src).toContain('name: COLLECTION_NAME');
    expect(src).toContain('name: "title"');
    expect(src).toContain('name: "body"');
    expect(src).toContain('name: "icon"');
  });

  it("includes all 3 seed tips", () => {
    expect(src).toContain("Try a feature request");
    expect(src).toContain("Every change is versioned");
    expect(src).toContain("The agent learns as you go");
  });

  it("is idempotent — checks for existing collection and existing titles", () => {
    // Collection check: getOne before create
    expect(src).toContain("getOne(COLLECTION_NAME)");
    // Title dedup: checks existingTitles before insert
    expect(src).toContain("existingTitles.has(tip.title)");
  });

  it("collection schema enforces maxSize on title (80) and body (240)", () => {
    expect(src).toContain("maxSize: 80");
    expect(src).toContain("maxSize: 240");
  });

  it("uses PocketBase 0.25.x SDK import", () => {
    expect(src).toMatch(/import PocketBase from ["']pocketbase["']/);
  });
});
