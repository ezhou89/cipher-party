import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./staging",
  fullyParallel: false,
  use: {
    baseURL: "https://staging.oddlyuseful.studio",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile-webkit-320x780",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 320, height: 780 },
      },
    },
  ],
});
