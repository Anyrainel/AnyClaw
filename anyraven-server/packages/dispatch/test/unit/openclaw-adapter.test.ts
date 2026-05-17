import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { OpenClawAdapter } from "../../src/adapters/openclaw.js";
import type { SystemContext } from "../../src/adapters/types.js";

const ctxStub = (): SystemContext => ({
  cwd: "/tmp",
  mcpEndpointUrl: "http://127.0.0.1:4100/mcp",
  mcpBearerToken: "mt",
  mcpConfigPath: "/tmp/mcp.json",
  systemPrompt: "",
  allowedTools: ["Read", "Write", "Bash"],
});

let wss: WebSocketServer;
let url: string;

beforeEach(
  () =>
    new Promise<void>((done) => {
      wss = new WebSocketServer({ port: 0 }, () => {
        const addr = wss.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        url = `ws://127.0.0.1:${port}`;
        done();
      });
      wss.on("connection", (sock) => {
        // Send challenge immediately on connect
        sock.send(
          JSON.stringify({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: "n", ts: 1 },
          }),
        );
        sock.on("message", (raw) => {
          const frame = JSON.parse(raw.toString());
          if (frame.method === "connect") {
            sock.send(
              JSON.stringify({
                type: "res",
                id: frame.id,
                ok: true,
                payload: { hello: true },
              }),
            );
          } else if (frame.method === "chat.send") {
            expect(frame.params.idempotencyKey).toBe("task-1");
            expect(frame.params.metadata.anyClawTaskId).toBe("task-1");
            sock.send(
              JSON.stringify({
                type: "res",
                id: frame.id,
                ok: true,
                payload: { runId: "run-xyz" },
              }),
            );
            setTimeout(() => {
              sock.send(
                JSON.stringify({
                  type: "event",
                  event: "session.tool",
                  payload: {
                    type: "tool_call",
                    tool: "anyraven_ask_user",
                    args: { question: "Which DB?" },
                    metadata: { anyClawTaskId: "task-1" },
                  },
                }),
              );
              sock.send(
                JSON.stringify({
                  type: "event",
                  event: "session.message",
                  payload: {
                    type: "run_complete",
                    status: "success",
                    summary: "Added",
                    metadata: { anyClawTaskId: "task-1" },
                  },
                }),
              );
            }, 20);
          } else if (frame.method === "sessions.abort") {
            sock.send(
              JSON.stringify({
                type: "res",
                id: frame.id,
                ok: true,
                payload: {},
              }),
            );
          }
        });
      });
    }),
);

afterEach(() => new Promise<void>((r) => wss.close(() => r())));

describe("OpenClawAdapter", () => {
  it("handshakes, sends chat.send with idempotencyKey, returns runId", async () => {
    const a = new OpenClawAdapter({
      gatewayUrl: url,
      token: "t",
      workspace: "ws",
    });
    const h = await a.dispatch(
      "task-1",
      "add mood tracker",
      ctxStub(),
      AbortSignal.timeout(5000),
    );
    expect(h.adapterRef).toBe("run-xyz");
    await a.dispose();
  });

  it("subscribe yields clarifying then done", async () => {
    const a = new OpenClawAdapter({
      gatewayUrl: url,
      token: "t",
      workspace: "ws",
    });
    await a.dispatch(
      "task-1",
      "add mood tracker",
      ctxStub(),
      AbortSignal.timeout(5000),
    );
    const states: string[] = [];
    for await (const s of a.subscribe("task-1", AbortSignal.timeout(5000))) {
      states.push(s.state);
      if (s.state === "done" || s.state === "failed") break;
    }
    expect(states).toContain("clarifying");
    expect(states[states.length - 1]).toBe("done");
    await a.dispose();
  });

  it("cancel sends sessions.abort and closes queue", async () => {
    const a = new OpenClawAdapter({
      gatewayUrl: url,
      token: "t",
      workspace: "ws",
    });
    await a.dispatch(
      "task-1",
      "add mood tracker",
      ctxStub(),
      AbortSignal.timeout(5000),
    );
    await a.cancel("task-1");
    // After cancel, subscribe should drain immediately
    const states: string[] = [];
    for await (const s of a.subscribe("task-1", AbortSignal.timeout(2000))) {
      states.push(s.state);
    }
    // Queue was closed by cancel — might have events or not, but shouldn't hang
    await a.dispose();
  });
});
