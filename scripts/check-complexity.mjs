import { readFile } from "node:fs/promises";
import { resolve, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { defaultRun, projectRoot, runChecked } from "./staging-common.mjs";

export function runtimeFile(file) {
  return (
    typeof file === "string" &&
    file === posix.normalize(file) &&
    /^(apps|packages)\/[^/]+\/src\/.+\.tsx?$/u.test(file) &&
    !/(?:\.(?:test|spec|typecheck|config|fixtures?|generated|helpers?)\.|\/(?:fixtures?|generated|helpers?)\.tsx?$|\.d\.ts$|\/(?:tests?|fixtures?|generated|helpers?|dist|coverage|\.wrangler)\/)/u.test(
      file,
    )
  );
}

function localName(node) {
  if (node.id?.name) return node.id.name;
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (
    ["Property", "MethodDefinition", "PropertyDefinition"].includes(
      parent?.type,
    )
  ) {
    return parent.key.type === "Identifier" ||
      parent.key.type === "PrivateIdentifier"
      ? parent.key.name
      : "<computed>";
  }
  return "<anonymous>";
}

async function measure(file, code, root) {
  const identities = new Map();
  const names = new WeakMap();
  const anonymous = new Map();
  const collector = {
    meta: { schema: [] },
    create(context) {
      return {
        onCodePathStart(path, node) {
          if (path.origin === "program") return;
          let parentName = "";
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (names.has(parent)) {
              parentName = `${names.get(parent)}/`;
              break;
            }
            if (
              parent.type === "ClassDeclaration" ||
              parent.type === "ClassExpression"
            ) {
              parentName = `${parent.id?.name ?? "<class>"}/`;
              break;
            }
          }
          let own = localName(node);
          if (path.origin !== "function") own += `<${path.origin}>`;
          if (own === "<anonymous>") {
            const next = (anonymous.get(parentName) ?? 0) + 1;
            anonymous.set(parentName, next);
            own += `#${next}`;
          }
          const name = parentName + own;
          names.set(node, name);
          let start = node.loc.start;
          if (path.origin === "function") {
            if (
              [
                "Property",
                "MethodDefinition",
                "PropertyDefinition",
                "TSPropertySignature",
                "TSMethodSignature",
              ].includes(node.parent?.type)
            )
              start = node.parent.loc.start;
            else if (node.type === "ArrowFunctionExpression")
              start = context.sourceCode.getTokenBefore(
                node.body,
                (token) => token.value === "=>",
              ).loc.start;
          }
          identities.set(
            `${start.line}:${start.column + 1}:${path.origin}`,
            name,
          );
        },
      };
    },
  };
  const eslint = new ESLint({
    cwd: root,
    allowInlineConfig: false,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            ecmaFeatures: { jsx: true },
          },
        },
        plugins: { inventory: { rules: { functions: collector } } },
        rules: {
          complexity: ["error", { max: 0, variant: "classic" }],
          "inventory/functions": "error",
        },
      },
    ],
  });
  const [result] = await eslint.lintText(code, { filePath: file });
  if (!result || result.fatalErrorCount > 0)
    throw new Error(
      "Complexity parsing failed; inspect tracked runtime syntax",
    );
  const diagnostics = result.messages.filter(
    (message) => message.ruleId === "complexity",
  );
  if (diagnostics.length !== identities.size)
    throw new Error(
      "Complexity inventory is incomplete; inspect tracked runtime syntax",
    );
  return diagnostics.map((message) => {
    const origin = message.message.startsWith("Class field initializer")
      ? "class-field-initializer"
      : message.message.startsWith("Class static block")
        ? "class-static-block"
        : "function";
    const name = identities.get(`${message.line}:${message.column}:${origin}`);
    const score = /has a complexity of (\d+)\./u.exec(message.message);
    if (!name || !score)
      throw new Error("Complexity diagnostic identity could not be resolved");
    return { file, name, complexity: Number(score[1]) };
  });
}

export async function checkComplexity({
  root = projectRoot,
  run = defaultRun,
  sources,
  baseline,
} = {}) {
  baseline ??= JSON.parse(
    await readFile(resolve(root, "scripts/complexity-baseline.json"), "utf8"),
  );
  if (!Array.isArray(baseline))
    throw new Error("Complexity baseline must be an array");
  if (sources === undefined) {
    const tracked = await runChecked(
      run,
      "git",
      ["ls-files", "-z"],
      root,
      "Tracked runtime discovery",
    );
    sources = await Promise.all(
      tracked.stdout
        .split("\0")
        .filter(runtimeFile)
        .map(async (file) => ({
          file,
          code: await readFile(resolve(root, file), "utf8"),
        })),
    );
  }
  const functions = [];
  for (const { file, code } of sources.filter(({ file }) => runtimeFile(file)))
    functions.push(...(await measure(file, code, root)));
  const violations = [];
  const caps = new Map();
  for (const entry of baseline) {
    if (
      !entry ||
      Object.keys(entry).sort().join() !== "file,max,name" ||
      !runtimeFile(entry.file) ||
      typeof entry.name !== "string" ||
      !Number.isInteger(entry.max) ||
      entry.max <= 20
    ) {
      violations.push("Invalid baseline entry");
      continue;
    }
    const key = `${entry.file}::${entry.name}`;
    if (caps.has(key)) violations.push(`Duplicate exemption: ${key}`);
    caps.set(key, entry.max);
    const matches = functions.filter(
      (value) => value.file === entry.file && value.name === entry.name,
    );
    if (matches.length !== 1 || matches[0].complexity <= 20)
      violations.push(`Missing, ambiguous or stale exemption: ${key}`);
  }
  for (const value of functions) {
    const key = `${value.file}::${value.name}`;
    if (value.complexity > (caps.get(key) ?? 20))
      violations.push(`Complexity cap exceeded: ${key} (${value.complexity})`);
  }
  return { functions, violations };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = await checkComplexity();
    for (const value of result.functions.filter(
      (value) => value.complexity > 10,
    ))
      console.log(JSON.stringify(value));
    const scores = result.functions.map((value) => value.complexity);
    console.log(
      `Classic complexity: ${scores.length} functions; mean ${(scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2)}; maximum ${Math.max(...scores)}`,
    );
    for (const violation of result.violations) console.error(violation);
    if (result.violations.length) process.exitCode = 1;
  } catch {
    console.error(
      "Complexity check failed; inspect tracked syntax and baseline configuration",
    );
    process.exitCode = 1;
  }
}
