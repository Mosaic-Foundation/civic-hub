// ESLint for civic-hub. One rule to start (Phase 2b, multi-tenant):
//
//   civic/raw-client — the raw, service-role database client sees every
//   hub's rows, so only the data layer, the control plane and operator tools
//   may import it. Request code reaches tenant data through forHub().
//
// What counts as the raw client: `@supabase/supabase-js`, and any module that
// carries the `@civic-raw-client` tag in its opening comment (today
// src/db/client.ts). Keying on the tag rather than a path means a second raw
// module is covered the moment it is tagged.
//
// Who may import it is declared by the FILE, not listed here: a file that
// imports the raw client carries a tag comment
//
//   // @civic-raw-client-importer: <why this file needs it>
//
// and the tag is honoured only under src/db/, src/control/, scripts/ and
// tests/ (the tests that prove what the database refuses, run against the
// local stack only). A tag anywhere else is itself an error, so a request
// module cannot tag its way out. Contract: BUILD-PLAN-multi-tenant.md →
// "3. Data layer" and "Phase 2b adds" item 7.

import { readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsParser from "@typescript-eslint/parser";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ALLOWED_ROOTS = ["src/db/", "src/control/", "scripts/", "tests/"];
const RAW_PACKAGES = [/^@supabase\/supabase-js(\/|$)/];
const PROVIDER_TAG = /^\s*\/\/\s*@civic-raw-client\b(?!-)/m;
const IMPORTER_TAG = /@civic-raw-client-importer:\s*\S/;

const taggedCache = new Map();

/** Is this relative import a module tagged @civic-raw-client? */
function isTaggedModule(fromFile, spec) {
  if (!spec.startsWith(".")) return false;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    base,
    `${base}.ts`,
    resolve(base, "index.ts"),
  ];
  for (const file of candidates) {
    if (!existsSync(file) || !/\.[cm]?[jt]s$/.test(file)) continue;
    if (!taggedCache.has(file)) {
      // Only the opening comment block counts, so a module that merely
      // mentions the tag in prose (as this file does) is not a provider.
      const head = readFileSync(file, "utf8").split("\n").slice(0, 3).join("\n");
      taggedCache.set(file, PROVIDER_TAG.test(head));
    }
    return taggedCache.get(file);
  }
  return false;
}

const rawClientRule = {
  meta: {
    type: "problem",
    docs: { description: "The raw database client is for src/db/, src/control/ and scripts/ only." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const rel = relative(ROOT, file).split("\\").join("/");
    const source = context.sourceCode.getText();
    const tagged = IMPORTER_TAG.test(source);
    const inAllowedRoot = ALLOWED_ROOTS.some((r) => rel.startsWith(r));

    function check(node, spec) {
      if (typeof spec !== "string") return;
      const raw = RAW_PACKAGES.some((re) => re.test(spec)) || isTaggedModule(file, spec);
      if (!raw) return;
      if (!inAllowedRoot) {
        context.report({
          node,
          message:
            `"${spec}" is the raw, service-role database client and sees every hub. ` +
            "Outside src/db/, src/control/ and scripts/, reach data through forHub(hubId) " +
            "(src/db/forHub.ts).",
        });
      } else if (!tagged) {
        context.report({
          node,
          message:
            `"${spec}" is the raw database client. A file allowed to import it says why, ` +
            "with a `// @civic-raw-client-importer: <reason>` comment.",
        });
      }
    }

    return {
      Program(node) {
        if (tagged && !inAllowedRoot) {
          context.report({
            node,
            message:
              "@civic-raw-client-importer is honoured only under src/db/, src/control/, " +
              "scripts/ and tests/. Convert this file to forHub() instead.",
          });
        }
      },
      ImportDeclaration: (n) => check(n, n.source.value),
      ExportNamedDeclaration: (n) => n.source && check(n, n.source.value),
      ExportAllDeclaration: (n) => check(n, n.source.value),
      ImportExpression: (n) => n.source.type === "Literal" && check(n, n.source.value),
    };
  },
};

export default [
  {
    ignores: ["node_modules/**", "dist/**", "ui/**", "test-results/**", "backups/**", "supabase/**"],
  },
  {
    files: ["src/**/*.ts", "api/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    languageOptions: { parser: tsParser, sourceType: "module", ecmaVersion: "latest" },
    // Other plugins' disable comments may exist in the tree; they are not errors here.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { civic: { rules: { "raw-client": rawClientRule } } },
    rules: { "civic/raw-client": "error" },
  },
];
