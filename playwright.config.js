import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 无 root 环境下 Chromium 依赖库可解压到用户目录，自动补充动态链接路径
["pwlibs/usr/lib/aarch64-linux-gnu", "pwlibs/usr/lib/x86_64-linux-gnu", "pwlibs/lib/aarch64-linux-gnu", "pwlibs/lib/x86_64-linux-gnu"]
  .map((dir) => join(homedir(), dir))
  .filter((dir) => existsSync(dir))
  .forEach((dir) => {
    const current = process.env.LD_LIBRARY_PATH;
    process.env.LD_LIBRARY_PATH = current ? `${dir}:${current}` : dir;
  });

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
