import { defineConfig } from "@playwright/test";

for (const key of ["NO_PROXY", "no_proxy"]) {
  const values = (process.env[key] || "").split(",").map((value) => value.trim()).filter(Boolean);
  process.env[key] = [...new Set([...values, "127.0.0.1", "localhost"])].join(",");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    ...(process.env.CI ? {} : { channel: "chrome" }),
    trace: "retain-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER ? undefined : {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
