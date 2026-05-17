#!/usr/bin/env node
// Mock claude binary that runs for a long time (for cancel testing).
process.stdout.write(
  JSON.stringify({ type: "system", session_id: "sess-slow" }) + "\n",
);
// Keep alive — will be killed by cancel
setTimeout(() => {
  process.stdout.write(
    JSON.stringify({ type: "result", result: "should not reach" }) + "\n",
  );
  process.exit(0);
}, 60000);
