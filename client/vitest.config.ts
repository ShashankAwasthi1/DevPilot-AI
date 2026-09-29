import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Phase 25 Step 3 - a deliberately separate command (`npm run test:components`)
// from the existing `npm test` (plain Node --test over lib/*.test.ts,
// unchanged). `include` is scoped to *.test.tsx specifically so this config
// can never accidentally pick up (or double-run) any of the existing
// lib/*.test.ts files, which use node:test/node:assert directly, not
// Vitest's API - the two suites are intentionally independent and never
// share a runner.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.tsx"],
    exclude: ["node_modules/**"],
  },
});
