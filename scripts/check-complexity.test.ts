import { describe, expect, it } from "vitest";
import { checkComplexity } from "./check-complexity.mjs";

const file = "apps/web/src/example.ts";
const source = (name: string, branches: number) =>
  `export function ${name}(x: number) { ${Array.from({ length: branches }, (_, index) => `if(x === ${index}) return ${index};`).join("\n")} return -1; }`;
const inspect = (
  code: string,
  baseline: Array<{ file: string; name: string; max: number }> = [],
) => checkComplexity({ sources: [{ file, code }], baseline });

describe("classic complexity gate", () => {
  it("does not honor inline suppressions and rejects syntax without echoing source", async () => {
    const result = await inspect(
      `/* eslint-disable complexity */\n${source("overLimit", 20)}`,
    );
    expect(result.violations).toHaveLength(1);
    await expect(inspect("function secretBroken( {")).rejects.toThrow(
      /^Complexity parsing failed/u,
    );
    expect(
      (
        await inspect(
          "// eslint-disable-next-line unknown/rule\nfunction valid(){}",
        )
      ).functions,
    ).toHaveLength(1);
  });
  it("measures classic switch branches and reports functions above ten", async () => {
    const result = await inspect(source("example", 10));
    expect(result.functions).toEqual([
      { file, name: "example", complexity: 11 },
    ]);
    expect(result.violations).toEqual([]);
    const switched = await inspect(
      "function choose(x) {switch(x){case 1:return 1;case 2:return 2;default:return 0;}}",
    );
    expect(switched.functions[0]?.complexity).toBe(3);
  });
  it("allows only an exact named existing exception and rejects increases", async () => {
    const baseline = [{ file, name: "legacy", max: 21 }];
    expect((await inspect(source("legacy", 20), baseline)).violations).toEqual(
      [],
    );
    expect(
      (await inspect(source("legacy", 21), baseline)).violations.length,
    ).toBe(1);
    expect((await inspect(source("newFunction", 20))).violations.length).toBe(
      1,
    );
  });
  it("rejects renamed, missing, stale and duplicate exemptions", async () => {
    const entry = { file, name: "legacy", max: 21 };
    for (const [code, baseline] of [
      [source("renamed", 20), [entry]],
      [source("small", 1), [entry]],
      [source("legacy", 1), [entry]],
      [source("legacy", 20), [entry, entry]],
    ] as const) {
      expect(
        (await inspect(code, [...baseline])).violations.length,
      ).toBeGreaterThan(0);
    }
  });
  it("names nested functions without line numbers and isolates their own scores", async () => {
    const result = await inspect(
      "function outer(){ function inner(x){if(x)return 1; return 0;} return inner(1); }",
    );
    expect(result.functions).toEqual([
      { file, name: "outer", complexity: 1 },
      { file, name: "outer/inner", complexity: 2 },
    ]);
    expect(
      (
        await inspect(
          "\n\nfunction outer(){ function inner(x){if(x)return 1; return 0;} return inner(1); }",
        )
      ).functions,
    ).toEqual(result.functions);
  });
  it("ignores injected non-runtime and generated/test/helper paths", async () => {
    const excluded = [
      ".superpowers/scratch.ts",
      "apps/web/src/example.test.ts",
      "apps/web/src/fixture/data.ts",
      "apps/web/src/test/helpers.ts",
      "apps/web/src/generated/data.ts",
      "apps/web/src/helpers.ts",
      "apps/web/src/api.helpers.ts",
      "apps/web/src/example.config.ts",
      "apps/web/src/generated.ts",
      "apps/web/vite.config.ts",
      "apps/web/src/types.d.ts",
      "apps/web/dist/bundle.ts",
    ];
    const result = await checkComplexity({
      sources: excluded.map((file) => ({ file, code: source("ignored", 40) })),
      baseline: [],
    });
    expect(result.functions).toEqual([]);
  });
});
