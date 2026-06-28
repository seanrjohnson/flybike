import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/flybike/" : "/",
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
