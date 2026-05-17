#!/usr/bin/env node
// Mock claude binary that emits stream-json lines to stdout.
process.stdout.write(
  JSON.stringify({ type: "system", subtype: "init", session_id: "sess-42" }) + "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "anyraven_ask_user",
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
