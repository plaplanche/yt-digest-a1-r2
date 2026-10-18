import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "node", include: ["tests/*.test.ts"] },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")) },
            },
          })),
        ],
        test: { name: "worker", include: ["tests/worker/*.test.ts"], setupFiles: ["./tests/worker/setup.ts"] },
      },
    ],
  },
});
