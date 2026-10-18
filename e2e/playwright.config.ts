import { defineConfig, devices } from "@playwright/test";

const workerPort = process.env.WORKER_PORT ?? "8787";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${workerPort}` },
  projects: [
    { name: "api", testMatch: /.*\.api\.spec\.ts/ },
    { name: "browser", testMatch: /.*\.browser\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
});
