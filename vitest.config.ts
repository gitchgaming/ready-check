import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One SQLite file shared by every test file, so files run one at a time.
    env: { DATABASE_URL: "file:./prisma/test.db" },
    globalSetup: ["test/globalSetup.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Generated client, and entry points that need a live Discord connection.
      exclude: [
        "src/generated/**",
        "src/index.ts",
        "src/check-staging.ts",
        "src/clear-global-commands.ts",
        "src/deploy-commands.ts",
        "src/deploy-emojis.ts",
      ],
      reporter: ["text", "html"],
    },
  },
});
