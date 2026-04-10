#!/usr/bin/env node
// Mock claude binary that emits stream-json lines to stdout.
process.stdout.write(
  JSON.stringify({ type: "system", session_id: "sess-42" }) + "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "anyclaw_ask_user",
          input: { question: "DB?" },
        },
      ],
    },
  }) + "\n",
);
process.stdout.write(
  JSON.stringify({ type: "result", result: "done description" }) + "\n",
);
process.exit(0);
