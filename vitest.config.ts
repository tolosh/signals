import { defineConfig } from "vitest/config";

// SIG-56: `--mode hosted` (npm run test:hosted) is the only way the mock tests reach the hosted
// mock; every other run is local, whatever MOCK_BASE_URL holds (test/mock/target.ts).
export default defineConfig(({ mode }) => ({
  test: {
    include: ["test/**/*.test.ts"],
    env: { MOCK_TARGET: mode === "hosted" ? "hosted" : "local" },
  },
}));
