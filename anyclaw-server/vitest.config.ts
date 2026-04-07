import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      // Upstream libsodium-wrappers ships a broken ESM build (references
      // ./libsodium.mjs which is not packaged). Force the CJS bundle which
      // is self-contained.
      "libsodium-wrappers": require.resolve("libsodium-wrappers"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
