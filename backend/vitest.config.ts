import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],           
    env: {
      APP_STAGE: "test",
      NODE_ENV: "test",
    },
    pool: "forks",
    maxWorkers: 1,
  },
});
