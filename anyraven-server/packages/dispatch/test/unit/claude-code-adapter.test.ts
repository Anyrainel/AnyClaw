import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code.js";

const mockBin = fileURLToPath(
  new URL("../fixtures/mock-claude.mjs", import.meta.url),
);

describe("ClaudeCodeAdapter", () => {
  it("writes mcp-config before spawn and persists session_id", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-"));
    const persistSessionId = vi.fn();
    const persistTaskStatus = vi.fn();
    const a = new ClaudeCodeAdapter({
      executablePath: process.execPath,
      executableArgs: [mockBin],
      maxBudgetUsd: 1,
      getApiKey: async () => "fake-key",
      persistSessionId,
      persistTaskStatus,
    });
    const ctx = {
      cwd: tmp,
      mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
      mcpBearerToken: "tok",
      mcpConfigPath: join(tmp, "mcp.json"),
      systemPrompt: "",
      allowedTools: ["Read", "Write", "Bash"],
    };
    const h = await a.dispatch(
      "t1",
      "build it",
      ctx,
      AbortSignal.timeout(10_000),
    );
    const cfg = JSON.parse(await readFile(ctx.mcpConfigPath, "utf8"));
    expect(cfg.mcpServers.anyraven.url).toBe(ctx.mcpEndpointUrl);
    expect(cfg.mcpServers.anyraven.headers["x-anyraven-task-id"]).toBe("t1");
    expect(h.taskId).toBe("t1");
    const states: string[] = [];
    for await (const s of a.subscribe("t1", AbortSignal.timeout(10_000))) {
      states.push(s.state);
      if (s.state === "done" || s.state === "failed") break;
    }
    expect(states).toEqual(expect.arrayContaining(["clarifying", "done"]));
    expect(persistSessionId).toHaveBeenCalledWith("t1", "sess-42");
  });

  it("emits failed on non-zero exit code", async () => {
    const failBin = fileURLToPath(
      new URL("../fixtures/mock-claude-fail.mjs", import.meta.url),
    );
    const tmp = await mkdtemp(join(tmpdir(), "cc-fail-"));
    const a = new ClaudeCodeAdapter({
      executablePath: process.execPath,
      executableArgs: [failBin],
      maxBudgetUsd: 1,
      getApiKey: async () => "fake-key",
    });
    const ctx = {
      cwd: tmp,
      mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
      mcpBearerToken: "tok",
      mcpConfigPath: join(tmp, "mcp.json"),
      systemPrompt: "",
      allowedTools: ["Read"],
    };
    await a.dispatch("t2", "fail", ctx, AbortSignal.timeout(10_000));
    const states: string[] = [];
    for await (const s of a.subscribe("t2", AbortSignal.timeout(10_000))) {
      states.push(s.state);
      if (s.state === "done" || s.state === "failed") break;
    }
    expect(states[states.length - 1]).toBe("failed");
  });

  it("emits failed when the executable is missing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "cc-missing-"));
    const a = new ClaudeCodeAdapter({
      executablePath: join(tmp, "missing-claude"),
      maxBudgetUsd: 1,
    });
    const ctx = {
      cwd: tmp,
      mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
      mcpBearerToken: "tok",
      mcpConfigPath: join(tmp, "mcp.json"),
      systemPrompt: "",
      allowedTools: ["Read"],
    };
    await a.dispatch("t-missing", "run", ctx, AbortSignal.timeout(10_000));
    const states: string[] = [];
    let error = "";
    for await (const s of a.subscribe("t-missing", AbortSignal.timeout(10_000))) {
      states.push(s.state);
      error = s.error ?? error;
      if (s.state === "done" || s.state === "failed") break;
    }
    expect(states[states.length - 1]).toBe("failed");
    expect(error).toContain("failed to start");
  });

  it("cancel kills the subprocess", async () => {
    const slowBin = fileURLToPath(
      new URL("../fixtures/mock-claude-slow.mjs", import.meta.url),
    );
    const tmp = await mkdtemp(join(tmpdir(), "cc-cancel-"));
    const a = new ClaudeCodeAdapter({
      executablePath: process.execPath,
      executableArgs: [slowBin],
      maxBudgetUsd: 1,
      getApiKey: async () => "fake-key",
    });
    const ctx = {
      cwd: tmp,
      mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
      mcpBearerToken: "tok",
      mcpConfigPath: join(tmp, "mcp.json"),
      systemPrompt: "",
      allowedTools: ["Read"],
    };
    await a.dispatch("t3", "slow", ctx, AbortSignal.timeout(10_000));
    await a.cancel("t3");
    // subscribe should drain after cancel
    const states: string[] = [];
    for await (const s of a.subscribe("t3", AbortSignal.timeout(5_000))) {
      states.push(s.state);
      if (s.state === "done" || s.state === "failed") break;
    }
    // Queue closed by cancel
    await a.dispose();
  });
});
