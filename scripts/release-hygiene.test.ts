import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("release hygiene", () => {
  it("keeps scratch evidence outside lint while linting tracked staging smoke", async () => {
    const eslint = new ESLint({ cwd: root });

    expect(
      await eslint.isPathIgnored(".superpowers/sdd/example/helper.ts"),
    ).toBe(true);
    expect(await eslint.isPathIgnored("staging/public-smoke.spec.ts")).toBe(
      false,
    );
  });

  it("keeps the public smoke opt-in and the default browser suite local", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["test:e2e"]).toBe("playwright test");
    expect(packageJson.scripts["smoke:staging:public"]).toBe(
      "playwright test --config playwright.staging.config.ts",
    );
  });

  it("uses a dedicated artifact-free public staging configuration", async () => {
    const configPath = resolve(root, "playwright.staging.config.ts");
    await expect(access(configPath)).resolves.toBeUndefined();
    const { default: config } = (await import(
      `${pathToFileURL(configPath).href}?release-hygiene`
    )) as {
      default: {
        testDir?: string;
        webServer?: unknown;
        use?: Record<string, unknown>;
        projects?: Array<{ name?: string; use?: Record<string, unknown> }>;
      };
    };

    expect(config.testDir).toBe("./staging");
    expect(config.webServer).toBeUndefined();
    expect(config.use).toMatchObject({
      baseURL: "https://staging.oddlyuseful.studio",
      trace: "off",
      screenshot: "off",
      video: "off",
      serviceWorkers: "block",
    });
    expect(
      config.projects?.map(({ name, use }) => ({
        name,
        browser: use?.defaultBrowserType,
        viewport: use?.viewport,
      })),
    ).toEqual([
      {
        name: "desktop-chromium",
        browser: "chromium",
        viewport: { width: 1280, height: 720 },
      },
      {
        name: "mobile-webkit-320x780",
        browser: "webkit",
        viewport: { width: 320, height: 780 },
      },
    ]);
  });
});
