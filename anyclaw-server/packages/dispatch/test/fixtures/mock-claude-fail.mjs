#!/usr/bin/env node
// Mock claude binary that exits with non-zero code.
process.stdout.write(
  JSON.stringify({ type: "system", session_id: "sess-fail" }) + "\n",
);
process.exit(1);
