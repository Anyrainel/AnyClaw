import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { VersionStore } from "../src/versionStore.js";

async function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@anyclaw.local");
  await git.addConfig("user.name", "Test");
  await git.addConfig("commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "init\n");
  await git.add(".");
  await git.commit("initial");
  // Ensure the default branch is `main` for consistency
  await git.raw(["branch", "-M", "main"]);
}

describe("VersionStore", () => {
  let root: string;
  let store: VersionStore;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "anyclaw-vs-"));
    await initRepo(root);
    store = new VersionStore(root);
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("commits a change and tags it as a version", async () => {
    writeFileSync(join(root, "feature.txt"), "hello\n");
    const v = await store.commitVersion({
      description: "Added a feature",
      files: ["feature.txt"],
    });
    expect(v.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(v.tag).toMatch(/^v\d+$/);
    expect(v.description).toBe("Added a feature");
  });

  it("lists versions newest-first", async () => {
    writeFileSync(join(root, "a.txt"), "a"); await store.commitVersion({ description: "A", files: ["a.txt"] });
    writeFileSync(join(root, "b.txt"), "b"); await store.commitVersion({ description: "B", files: ["b.txt"] });
    writeFileSync(join(root, "c.txt"), "c"); await store.commitVersion({ description: "C", files: ["c.txt"] });
    const list = await store.list();
    expect(list.map(v => v.description)).toEqual(["C", "B", "A"]);
    expect(list.map(v => v.tag)).toEqual(["v3", "v2", "v1"]);
  });

  it("checks out a prior version (restoring file contents)", async () => {
    writeFileSync(join(root, "x.txt"), "one");
    const v1 = await store.commitVersion({ description: "one", files: ["x.txt"] });
    writeFileSync(join(root, "x.txt"), "two");
    await store.commitVersion({ description: "two", files: ["x.txt"] });

    await store.checkoutVersion(v1.tag);
    expect(readFileSync(join(root, "x.txt"), "utf8")).toBe("one");
  });
});
