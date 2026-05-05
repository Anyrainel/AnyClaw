import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "arch.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
