import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/e2e.json" }],
    ["html", { outputFolder: "test-results/browser-report", open: "never" }],
  ],
  outputDir: "test-results/browser-artifacts",
  use: {
    baseURL: "http://127.0.0.1:4188",
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node server/index.mjs --production",
    url: "http://127.0.0.1:4188/api/health",
    reuseExistingServer: false,
    timeout: 20000,
    env: {
      PORT: "4188",
      HOST: "127.0.0.1",
      LOCAL_ACCESS: "1",
      MIWEB_ACCESS_KEY: "",
      PUBLIC_ORIGIN: "",
    },
  },
});
