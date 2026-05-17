import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_PATH = join(__dirname, "..", "..", "..", "install.sh");
const src = readFileSync(SCRIPT_PATH, "utf-8");

describe("install.sh script validation", () => {
  it("starts with bash shebang and strict mode", () => {
    expect(src).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(src).toContain("set -euo pipefail");
  });

  it("has all 6 phases", () => {
    expect(src).toContain("[1/6]");
    expect(src).toContain("[2/6]");
    expect(src).toContain("[3/6]");
    expect(src).toContain("[4/6]");
    expect(src).toContain("[5/6]");
    expect(src).toContain("[6/6]");
  });

  it("checks for Docker and exits with install message on macOS", () => {
    expect(src).toContain("Docker Desktop");
    expect(src).toContain("docker.com");
  });

  it("checks Docker daemon is running", () => {
    expect(src).toContain("docker info");
    expect(src).toContain("Docker daemon is not running");
  });

  it("exits 1 for unknown OS", () => {
    expect(src).toContain("Unsupported operating system");
    expect(src).toMatch(/detect_os/);
    expect(src).toContain('"unknown"');
  });

  it("warns on less than 2GB RAM but continues", () => {
    expect(src).toContain("2097152");
    expect(src).toContain("Less than 2 GB RAM");
    // It's a warn(), not error() — so the script continues
    expect(src).toMatch(/warn\s+.*Less than 2 GB RAM/);
  });

  it("reads LLM key silently with read -rsp", () => {
    expect(src).toContain("read -rsp");
  });

  it("POSTs LLM key to http://127.0.0.1:4100/internal/api-keys", () => {
    expect(src).toContain("http://127.0.0.1:4100/internal/api-keys");
    expect(src).toContain('\\"provider\\"');
    expect(src).toContain('\\"key\\"');
  });

  it("never writes the raw LLM key to a file", () => {
    // After the curl POST, the key is cleared from the variable
    expect(src).toContain('ANYRAVEN_LLM_KEY=""');
    // The key is only used in the curl -d body, never in a redirect or tee
    const lines = src.split("\n");
    const keyWriteLines = lines.filter(
      (l) =>
        l.includes("ANYRAVEN_LLM_KEY") &&
        (l.includes(">") || l.includes("tee")) &&
        !l.includes("curl") &&
        !l.includes('=""'),
    );
    expect(keyWriteLines).toHaveLength(0);
  });

  it("uses PocketBase 0.25.x _superusers endpoints", () => {
    expect(src).toContain("/api/collections/_superusers/auth-with-password");
    expect(src).toContain("/api/collections/_superusers/impersonate/");
  });

  it("detects openclaw and runs package-skills.sh openclaw", () => {
    expect(src).toContain("command -v openclaw");
    expect(src).toContain("package-skills.sh openclaw");
  });

  it("detects claude and runs package-skills.sh claude-code", () => {
    expect(src).toContain("command -v claude");
    expect(src).toContain("package-skills.sh claude-code");
  });

  it("prints generic MCP URL instructions when neither agent is found", () => {
    expect(src).toContain("No agent CLI detected");
    expect(src).toContain("/mcp");
  });

  it("preserves existing .env on re-run", () => {
    expect(src).toContain("Existing .env found");
    expect(src).toContain("preserving configuration");
  });

  it("waits for PocketBase health before bootstrap", () => {
    expect(src).toContain("/api/health");
    expect(src).toContain("wait_for_pocketbase");
    expect(src).toContain("/anyraven/scripts/init-data-layout.sh");
  });

  it("can sync the frontend template into the dev workspace when requested", () => {
    expect(src).toContain("ANYRAVEN_SYNC_FRONTEND_TEMPLATE");
    expect(src).toContain("sync-frontend-template.sh --force");
  });

  it("seeds the welcome page tips collection", () => {
    expect(src).toContain("seed-welcome-collection.js");
  });
});
