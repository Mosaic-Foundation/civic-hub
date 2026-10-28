// ESLint for civic-hub. Its own rules: civic/raw-client (below),
// civic/control-boundary, civic/authz-seam and civic/hosting-boundary
// (further down). The first
// (Phase 2b, multi-tenant):
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
// and the tag is honoured only under src/db/, src/control/, src/hosting/
// (Supabase Storage, ADR-012), scripts/ and tests/ (the tests that prove what the database refuses, run against the
// local stack only). A tag anywhere else is itself an error, so a request
// module cannot tag its way out. Contract: BUILD-PLAN-multi-tenant.md →
// "3. Data layer" and "Phase 2b adds" item 7.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsParser from "@typescript-eslint/parser";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ALLOWED_ROOTS = ["src/db/", "src/control/", "src/hosting/", "scripts/", "tests/"];
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
              "@civic-raw-client-importer is honoured only under src/db/, src/control/, src/hosting/, " +
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

// The super admin (src/control/) is reachable only through the entry points
// that choose it by hostname (src/control/index.ts). The hub app — src/app.ts
// and everything under src/ it can reach — must not import it, so no hub
// request can end up running control-plane code (Adam, 2026-09-26).
const CONTROL_DIR = "src/control/";
const CONTROL_IMPORTERS = ["src/control/", "api/", "scripts/", "tests/"];
const CONTROL_ENTRY_FILES = ["src/index.ts"];

function resolvesIntoControl(fromFile, spec) {
  if (!spec.startsWith(".")) return false;
  const target = relative(ROOT, resolve(dirname(fromFile), spec)).split("\\").join("/");
  return target === "src/control" || target.startsWith(CONTROL_DIR);
}

const controlBoundaryRule = {
  meta: {
    type: "problem",
    docs: { description: "Only the entry points may import the super admin (src/control/)." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const rel = relative(ROOT, file).split("\\").join("/");
    const allowed = CONTROL_IMPORTERS.some((r) => rel.startsWith(r)) || CONTROL_ENTRY_FILES.includes(rel);
    function check(node, spec) {
      if (allowed || typeof spec !== "string" || !resolvesIntoControl(file, spec)) return;
      context.report({
        node,
        message:
          `"${spec}" is the super admin (src/control/). The hub app may not import it; ` +
          "only the entry points (api/index.ts, src/index.ts) mount it, by hostname. See src/control/index.ts.",
      });
    }
    return {
      ImportDeclaration: (n) => check(n, n.source.value),
      ExportNamedDeclaration: (n) => n.source && check(n, n.source.value),
      ExportAllDeclaration: (n) => check(n, n.source.value),
      ImportExpression: (n) => n.source.type === "Literal" && check(n, n.source.value),
    };
  },
};

// The hosting boundary (Architecture 5, ADR-012): the engine knows nothing
// about where it runs. Outside the hosting layer this refuses:
//   - importing src/hosting/ (the vendors' implementations, the console's
//     reads of the operations services);
//   - importing `hostingEnv` (the vendors' and the host's settings);
//   - importing a vendor's package directly.
// The engine calls the adapters in src/adapters/ instead. Allowed: the
// hosting layer itself, the console (src/control/), the composition roots
// (src/app.ts, src/index.ts, api/), scripts and tests.
const HOSTING_DIR = "src/hosting/";
const HOSTING_IMPORTERS = ["src/hosting/", "src/control/", "api/", "scripts/", "tests/"];
const HOSTING_ENTRY_FILES = ["src/index.ts", "src/app.ts"];
const VENDOR_PACKAGES = [/^youtube-transcript(\/|$)/, /^@anthropic-ai\//, /^resend$/, /^@sentry\//, /^@vercel\//];

function resolvesIntoHosting(fromFile, spec) {
  if (!spec.startsWith(".")) return false;
  const target = relative(ROOT, resolve(dirname(fromFile), spec)).split("\\").join("/");
  return target === "src/hosting" || target.startsWith(HOSTING_DIR);
}

const hostingBoundaryRule = {
  meta: {
    type: "problem",
    docs: { description: "The engine may not import the hosting layer, its settings or a vendor's package." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const rel = relative(ROOT, file).split("\\").join("/");
    if (HOSTING_IMPORTERS.some((r) => rel.startsWith(r)) || HOSTING_ENTRY_FILES.includes(rel)) return {};
    function check(node, spec) {
      if (typeof spec !== "string") return;
      if (resolvesIntoHosting(file, spec)) {
        context.report({
          node,
          message:
            `"${spec}" is the hosting layer (src/hosting/). The engine calls an adapter in src/adapters/ instead; ` +
            "only src/hosting/index.ts chooses the implementations (ADR-012).",
        });
      } else if (VENDOR_PACKAGES.some((re) => re.test(spec))) {
        context.report({ node, message: `"${spec}" is a vendor's package: it belongs in src/hosting/, behind an adapter (ADR-012).` });
      }
    }
    return {
      ImportDeclaration(n) {
        check(n, n.source.value);
        for (const sp of n.specifiers) {
          if (sp.type === "ImportSpecifier" && sp.imported.name === "hostingEnv") {
            context.report({
              node: sp,
              message: "hostingEnv holds the vendors' and the host's settings; only src/hosting/, src/control/ and api/ read it (ADR-012).",
            });
          }
        }
      },
      ExportNamedDeclaration: (n) => n.source && check(n, n.source.value),
      ExportAllDeclaration: (n) => check(n, n.source.value),
      ImportExpression: (n) => n.source.type === "Literal" && check(n, n.source.value),
    };
  },
};

// The database convention (Architecture 5, ADR-012):
//   - A module (src/modules/civic.*) never imports src/db/. It declares a
//     store in its own store.ts and the host binds it (src/stores/). Types and
//     error classes may still be imported from src/db/. A plugin package
//     (packages/) reaches the database only through its host's db(), its
//     granted tables only (civic/package-boundary, ADR-014).
//   - Only processService owns the `processes` table: `.from("processes")`
//     appears in src/services/processService.ts and processRows.ts (and the
//     data layer, the console's export reader, scripts and tests), nowhere
//     else.
//   - A controller does not query: no forHub/readAll/inChunks/getDb in
//     src/controllers/. It calls a service or a module.
// Every module, controller and caller was converted when the rule came in;
// it has no exemptions.
const PROCESS_TABLE_OWNERS = ["src/services/processService.ts", "src/services/processRows.ts", "src/db/", "src/control/hubBundle/"];
const QUERY_NAMES = new Set(["forHub", "readAll", "inChunks", "getDb", "getHubTokenDb"]);

function resolvesIntoDb(fromFile, spec) {
  if (!spec.startsWith(".")) return false;
  const target = relative(ROOT, resolve(dirname(fromFile), spec)).split("\\").join("/");
  return target === "src/db" || target.startsWith("src/db/");
}

const dbConventionRule = {
  meta: {
    type: "problem",
    docs: { description: "Modules use their store, only processService queries `processes`, controllers do not query (ADR-012)." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const rel = relative(ROOT, file).split("\\").join("/");
    const isPlugin = rel.startsWith("src/modules/");
    const pluginChecked = isPlugin;
    const isController = rel.startsWith("src/controllers/");
    const tableChecked = (rel.startsWith("src/") || rel.startsWith("packages/")) && !PROCESS_TABLE_OWNERS.some((p) => rel.startsWith(p));
    return {
      ImportDeclaration(n) {
        const spec = n.source.value;
        if (typeof spec !== "string" || !resolvesIntoDb(file, spec)) return;
        if (pluginChecked && n.importKind !== "type") {
          const values = n.specifiers.filter((sp) => sp.importKind !== "type");
          const bad = values.filter((sp) => !(sp.type === "ImportSpecifier" && /Error$/.test(sp.imported.name)));
          if (bad.length > 0 || values.length === 0 && n.specifiers.length === 0) {
            context.report({
              node: n,
              message:
                `"${spec}" is the database layer. A module (a plugin) declares the persistence it needs in its ` +
                "store.ts and the host binds it in src/stores/ (ADR-012); only types and error classes come from src/db/.",
            });
          }
        }
        if (isController) {
          for (const sp of n.specifiers) {
            if (sp.type === "ImportSpecifier" && QUERY_NAMES.has(sp.imported.name)) {
              context.report({
                node: sp,
                message: `A controller does not query (${sp.imported.name}): it calls a service or a module (ADR-012).`,
              });
            }
          }
        }
      },
      CallExpression(n) {
        if (!tableChecked) return;
        const callee = n.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "from" &&
          n.arguments.length === 1 &&
          n.arguments[0].type === "Literal" &&
          n.arguments[0].value === "processes"
        ) {
          context.report({
            node: n,
            message:
              "Only processService queries the processes table: use a function in src/services/processRows.ts " +
              "(or add one there) instead (ADR-012).",
          });
        }
      },
    };
  },
};

// The authorization seam (Architecture 4, ADR-011): every "may this person do
// this" is asked of canActor in src/authz/, by account, never by address.
// Outside src/authz/ this refuses:
//   - reading role grants (src/db/hubRolesStore.ts) — only its cache drop,
//     invalidateHubRoles, may be imported, by code that changes the grants;
//   - testing an actor's roles (`.roles.has(...)` / `.roles.get(...)`);
//   - `isAdminEmail`, the email check the seam replaced;
//   - reading the people lists (people.admin_emails, people.board_emails, the
//     announcement-author list) except in the files below, each for a reason
//     that is not authorization. The lists are the INPUT to hub_roles; a new
//     reader that wants to know who may do something asks canActor instead.
const PEOPLE_LIST_READERS = {
  "src/services/hubSettings.ts": "the lists' own readers and writers",
  "src/models/hubSettings.ts": "the key names",
  "src/controllers/hubPeopleController.ts": "the admin panel edits the lists",
  "src/controllers/adminSettingsController.ts": "the admin panel shows the lists",
  "src/control/hubs.ts": "the console sets a hub's admins (create, handover)",
  "src/services/mailGuard.ts": "mail: who may receive the hub's mail",
  "src/jobs/adminDigest.ts": "mail: the admin digest's recipients",
  "src/services/cronAlerts.ts": "mail: meeting-summary notices to admins",
  "src/modules/civic.feedback/service.ts": "mail: feedback to admins",
  "src/services/waitlistNotify.ts": "mail: waitlist notices to admins",
  "src/modules/civic.review/service.ts": "mail: new-submission notices to admins",
  "src/services/privilegedAccounts.ts": "sign-in admission: an address before any account exists",
  "src/modules/civic.auth/index.ts": "sign-in admission: the beta allowlist's admins and board",
  "src/services/modeReadiness.ts": "the leaving-demo readiness report (have the listed people signed up?)",
  "src/services/officials.ts": "moving the legacy author list onto accounts",
  "src/plugins/host.ts": "mail: a package's notices to admins, through its granted mail adapter (ADR-014)",
};
const PEOPLE_LIST_NAMES = new Set([
  "getAdminEmailsSync", "getAdminEmails", "getBoardEmailsSync", "getBoardEmails",
  "getAnnouncementAuthors", "lookupAuthor", "lookupAuthorLabel", "peopleListsFrom",
]);
const PEOPLE_LIST_KEYS = new Set(["PEOPLE_ADMIN_EMAILS", "PEOPLE_BOARD_EMAILS", "PEOPLE_ANNOUNCEMENT_AUTHORS"]);

function resolvesTo(fromFile, spec, target) {
  if (!spec.startsWith(".")) return false;
  return relative(ROOT, resolve(dirname(fromFile), spec)).split("\\").join("/").replace(/\.js$/, "") === target;
}

const authzSeamRule = {
  meta: {
    type: "problem",
    docs: { description: "Authorization is asked of canActor (src/authz/), by account." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const rel = relative(ROOT, file).split("\\").join("/");
    if (rel.startsWith("src/authz/") || !(rel.startsWith("src/") || rel.startsWith("api/") || rel.startsWith("packages/"))) return {};
    const listReader = rel in PEOPLE_LIST_READERS;
    const SEAM = "Ask canActor (src/authz/canActor.ts) instead; the rule for adding a check is in its header and ADR-011.";
    return {
      ImportDeclaration(n) {
        const spec = n.source.value;
        if (typeof spec !== "string") return;
        if (resolvesTo(file, spec, "src/db/hubRolesStore") && n.importKind !== "type") {
          for (const sp of n.specifiers) {
            if (sp.type === "ImportSpecifier" && sp.importKind !== "type" && sp.imported.name === "invalidateHubRoles") continue;
            if (sp.type === "ImportSpecifier" && sp.importKind === "type") continue;
            context.report({ node: sp, message: `Role grants are read only by src/authz/. ${SEAM}` });
          }
        }
        if (!listReader) {
          for (const sp of n.specifiers) {
            if (sp.type === "ImportSpecifier" && PEOPLE_LIST_NAMES.has(sp.imported.name) && sp.importKind !== "type") {
              context.report({
                node: sp,
                message: `${sp.imported.name} reads a people list, the input to hub_roles. ${SEAM} (A reader with another reason is named, with it, in eslint.config.js PEOPLE_LIST_READERS.)`,
              });
            }
          }
        }
      },
      MemberExpression(n) {
        if (!listReader && n.property.type === "Identifier" && PEOPLE_LIST_KEYS.has(n.property.name)) {
          context.report({ node: n, message: `KEYS.${n.property.name} is a people list, the input to hub_roles. ${SEAM}` });
        }
      },
      CallExpression(n) {
        const c = n.callee;
        if (
          c.type === "MemberExpression" && c.property.type === "Identifier" && (c.property.name === "has" || c.property.name === "get") &&
          c.object.type === "MemberExpression" && c.object.property.type === "Identifier" && c.object.property.name === "roles"
        ) {
          context.report({ node: n, message: `An actor's roles are read only by src/authz/. ${SEAM}` });
        }
      },
      Identifier(n) {
        if (n.name === "isAdminEmail") context.report({ node: n, message: `isAdminEmail was replaced by the seam. ${SEAM}` });
      },
    };
  },
};

// civic/package-boundary (plugin session 1, ADR-014). A plugin package
// (packages/<dir>/) reaches the hub only through the plugin SDK
// (src/sdk/index.ts), plain shared data (src/shared/), its own files, the
// packages its index.ts `requires`, Node's built-ins and the npm packages its
// package.json lists as peerDependencies (express, and what it parses with). Its
// manifest.ts reaches only src/shared/ and src/processes/manifest.ts, because
// the UI reads it. In the other direction, engine code (src/) never imports a
// package: the hub loads them from the configured list (config/plugins/).
// The engine files that still reach into one are listed below with why; the
// list only shrinks (tests/unit/packageBoundary.test.ts fails on an entry
// that no longer reaches a package).
export const PACKAGE_REACH_NOT_YET = {
  "src/services/sampleSeed.ts": "seeds every type's sample content by calling its service; each package should contribute its own samples",
  "src/debug/seedData.ts": "the debug seed writes a sample conversation's state in the conversation package's type",
  "src/processes/spawnBrief.ts": "makes the pending brief when a process closes: its state type (BriefProcessState) and its aggregation event (emitBriefAggregationCompleted)",
  "src/services/briefRegenerate.ts": "regenerates a brief: builds its state (createBriefState), emits its updated event and types its content",
  "src/services/briefResponses.ts": "stores the brief's responses and types them (BriefResponseRecord)",
  "src/debug/autoSeed.ts": "seeds an announcement's published state and events (emitPublicationEvents, AnnouncementProcessState) for the development scenarios",
  "src/jobs/newsSync.ts": "posts each news item as an announcement: its result-published event (emitAnnouncementResultPublished) and its state types",
  "src/modules/civic.admin_digest/service.ts": "the admin digest sorts summaries waiting for review by their quality flag (effectiveQualityFlag)",
  "src/controllers/debugController.ts": "the development reset empties the proposals (clearProposals) along with the other modules' records",
  "src/controllers/inputController.ts": "checks that the proposal an input names exists (proposalExists) before it is accepted",
};

const PACKAGES_DIR = "packages/";
// A feature package (ADR-016): a hub feature built as a plugin package is,
// under features/<dir>/. The same fence: the SDK, src/shared/, its own files,
// node: built-ins and its peerDependencies; its manifest.ts plain data. The
// engine reaches one only through the host's lists in config/.
const FEATURES_DIR = "features/";
// A package written outside this repository, as examples/ holds one (plugin
// session 2, ADR-015): it reaches the hub only through the SDK by its npm
// name. kit/conformance checks the same rule for a submitted package.
const OUTSIDE_DIR = "examples/";
const OUTSIDE_SDK = ["@civic-social/plugin-sdk", "@civic-social/plugin-sdk/manifest"];
const FEATURE_LIST_READERS = {
  "src/plugins/features.ts": "config/features.ts",
  "src/shared/featureManifests.ts": "config/featureManifests.ts",
};
const ENGINE_LIST_READERS = {
  "src/plugins/loader.ts": "config/plugins/server.ts",
  "src/shared/processManifests.ts": "config/plugins/manifests.ts",
  "src/plugins/mountedState.ts": "config/plugins/manifests.ts",
  "src/plugins/grant.ts": "config/plugins/manifests.ts",
};

const peerDependenciesCache = new Map();
/** The npm packages a package's package.json lists as peerDependencies. */
function peerDependencies(pkgDir) {
  if (peerDependenciesCache.has(pkgDir)) return peerDependenciesCache.get(pkgDir);
  const pj = resolve(ROOT, pkgDir, "package.json");
  const names = existsSync(pj) ? Object.keys(JSON.parse(readFileSync(pj, "utf8")).peerDependencies ?? {}) : [];
  peerDependenciesCache.set(pkgDir, names);
  return names;
}

const packageNamesCache = new Map();
/** The directories (packages/<dir>) of the packages a package's index.ts requires, by name. */
function requiredDirs(pkgDir) {
  if (packageNamesCache.has(pkgDir)) return packageNamesCache.get(pkgDir);
  const byName = new Map();
  const base = resolve(ROOT, PACKAGES_DIR);
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const pj = resolve(base, d, "package.json");
      if (existsSync(pj)) byName.set(JSON.parse(readFileSync(pj, "utf8")).name, `${PACKAGES_DIR}${d}`);
    }
  }
  const index = resolve(ROOT, pkgDir, "index.ts");
  const text = existsSync(index) ? readFileSync(index, "utf8") : "";
  const m = /requires:\s*\[([^\]]*)\]/.exec(text);
  const names = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  const dirs = names.map((n) => byName.get(n)).filter(Boolean);
  packageNamesCache.set(pkgDir, dirs);
  return dirs;
}

const packageBoundaryRule = {
  meta: {
    type: "problem",
    docs: { description: "A plugin package reaches the hub only through the SDK; the engine never imports a package (ADR-014)." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const rel = relative(ROOT, file).split("\\").join("/");
    const inPackage = rel.startsWith(PACKAGES_DIR);
    const inEngine = rel.startsWith("src/");
    // A package here written on SDK v1 (it peer-depends on the SDK, as the
    // Events package does) is held to the outside rule: liftable into its own
    // repository without a code change.
    const inOutside =
      rel.startsWith(OUTSIDE_DIR) ||
      (inPackage && peerDependencies(rel.split("/").slice(0, 2).join("/")).includes("@civic-social/plugin-sdk"));
    if (inOutside) {
      const dir = rel.split("/").slice(0, 2).join("/");
      const manifest = rel === `${dir}/manifest.ts`;
      const checkOutside = (node, spec) => {
        if (typeof spec !== "string") return;
        if (spec.startsWith(".")) {
          const target = relative(ROOT, resolve(dirname(file), spec)).split("\\").join("/");
          if (!target.startsWith(`${dir}/`)) context.report({ node, message: `"${spec}": a package imports only its own files and the SDK by name (ADR-015).` });
          return;
        }
        const allowed = manifest
          ? spec === "@civic-social/plugin-sdk/manifest"
          : OUTSIDE_SDK.includes(spec) || spec.startsWith("node:") || peerDependencies(dir).includes(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
        if (!allowed) {
          context.report({
            node,
            message: manifest
              ? `"${spec}": a manifest is plain data; it imports only @civic-social/plugin-sdk/manifest (ADR-015).`
              : `"${spec}": a package written outside the hub imports @civic-social/plugin-sdk (and /manifest), node: built-ins and its peerDependencies (ADR-015).`,
          });
        }
      };
      return {
        ImportDeclaration: (n) => checkOutside(n, n.source.value),
        ExportNamedDeclaration: (n) => n.source && checkOutside(n, n.source.value),
        ExportAllDeclaration: (n) => checkOutside(n, n.source.value),
        ImportExpression: (n) => n.source.type === "Literal" && checkOutside(n, n.source.value),
      };
    }
    const inFeature = rel.startsWith(FEATURES_DIR);
    if (!inPackage && !inEngine && !inFeature) return {};
    const pkgDir = inPackage || inFeature ? rel.split("/").slice(0, 2).join("/") : null;
    const isManifest = (inPackage || inFeature) && rel === `${pkgDir}/manifest.ts`;

    function check(node, spec) {
      if (typeof spec !== "string") return;
      if (inPackage || inFeature) {
        if (!spec.startsWith(".")) {
          // This repository's packages reach the hub by the SDK's name (ADR-017):
          // their code through /first-party (version 0), their manifest through
          // /manifest. Features still use src/sdk/index.ts relatively.
          if (inPackage && !isManifest && spec === "@civic-social/plugin-sdk/first-party") return;
          if (inPackage && isManifest && spec === "@civic-social/plugin-sdk/manifest") return;
          const bare = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
          if (isManifest || !(spec.startsWith("node:") || peerDependencies(pkgDir).includes(bare))) {
            context.report({
              node,
              message: inPackage
                ? `"${spec}": a plugin package imports the hub as @civic-social/plugin-sdk/first-party (its manifest, /manifest), and of other packages only node: built-ins and the peerDependencies its package.json lists (ADR-014, ADR-017).`
                : `"${spec}": a feature package imports the hub through src/sdk/index.ts, and of other packages only node: built-ins and the peerDependencies its package.json lists (ADR-014).`,
            });
          }
          return;
        }
        const target = relative(ROOT, resolve(dirname(file), spec)).split("\\").join("/").replace(/\.js$/, "");
        if (target.startsWith(`${pkgDir}/`)) return;
        if (target.startsWith("src/shared/")) return;
        if (isManifest) {
          if (target === "src/processes/manifest" && !inPackage) return;
          context.report({ node, message: `"${spec}": a manifest is plain data the UI reads; it imports only src/shared/ and src/processes/manifest.ts.` });
          return;
        }
        // A package reaches the SDK by its name now (ADR-017); a feature still by path.
        if ((target === "src/sdk/index" || target === "src/sdk") && !inPackage) return;
        if (inPackage && requiredDirs(pkgDir).some((d) => target.startsWith(`${d}/`))) return;
        context.report({
          node,
          message: inPackage
            ? `"${spec}": a plugin package reaches the hub only through @civic-social/plugin-sdk/first-party (add the name to src/sdk/index.ts), src/shared/, its own files and the packages it requires (ADR-014, ADR-017).`
            : `"${spec}": a feature package reaches the hub only through src/sdk/index.ts (add the name there), src/shared/, its own files (ADR-014).`,
        });
        return;
      }
      if (!spec.startsWith(".")) return;
      const target = relative(ROOT, resolve(dirname(file), spec)).split("\\").join("/").replace(/\.js$/, ".ts");
      if (target.startsWith(PACKAGES_DIR) && !(rel in PACKAGE_REACH_NOT_YET)) {
        context.report({ node, message: `"${spec}": the engine never imports a plugin package; the hub loads them from config/plugins.json (ADR-014).` });
      }
      if (target.startsWith(FEATURES_DIR)) {
        context.report({ node, message: `"${spec}": the engine never imports a feature package; the hub loads them from config/features.ts (ADR-016).` });
      }
      if ((target === "config/features.ts" || target === "config/featureManifests.ts") && FEATURE_LIST_READERS[rel] !== target) {
        context.report({ node, message: `"${spec}": only the feature loader and the feature manifest list read the configured features (ADR-016).` });
      }
      if (target.startsWith("config/plugins/") && ENGINE_LIST_READERS[rel] !== target) {
        context.report({ node, message: `"${spec}": only the loader and the manifest list read the configured packages (ADR-014).` });
      }
    }

    return {
      ImportDeclaration: (n) => check(n, n.source.value),
      ExportNamedDeclaration: (n) => n.source && check(n, n.source.value),
      ExportAllDeclaration: (n) => check(n, n.source.value),
      ImportExpression: (n) => n.source.type === "Literal" && check(n, n.source.value),
    };
  },
};

export default [
  {
    // features/*/ui/ is a feature's UI (ADR-016), read by the UI's build like a package's ui.tsx.
    ignores: ["node_modules/**", "dist/**", "ui/**", "test-results/**", "backups/**", "supabase/**", "features/*/ui/**"],
  },
  {
    files: ["src/**/*.ts", "packages/**/*.ts", "features/**/*.ts", "api/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "kit/**/*.ts", "examples/**/*.ts"],
    languageOptions: { parser: tsParser, sourceType: "module", ecmaVersion: "latest" },
    // Other plugins' disable comments may exist in the tree; they are not errors here.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { civic: { rules: { "raw-client": rawClientRule, "control-boundary": controlBoundaryRule, "authz-seam": authzSeamRule, "hosting-boundary": hostingBoundaryRule, "db-convention": dbConventionRule, "package-boundary": packageBoundaryRule } } },
    rules: { "civic/raw-client": "error", "civic/control-boundary": "error", "civic/authz-seam": "error", "civic/hosting-boundary": "error", "civic/db-convention": "error", "civic/package-boundary": "error" },
  },
  // One typed config module (Audit 4, F7): the server and api/ read their
  // environment only through src/config/env.ts. Scripts and tests read their
  // own.
  {
    files: ["src/**/*.ts", "packages/**/*.ts", "features/**/*.ts", "api/**/*.ts"],
    ignores: ["src/config/env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Read the environment through src/config/env.ts (env.X)." },
      ],
    },
  },
  // A process manifest is plain data the UI also reads (Architecture 2,
  // ADR-009): it imports types from anywhere, and values only from
  // src/shared/ and defineManifest() (src/processes/manifest.ts, itself plain).
  // The list of manifests imports nothing but manifests.
  {
    files: ["src/modules/*/manifest.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "^(?!(\\.\\./)+shared/|\\.\\./\\.\\./processes/manifest\\.js$)",
          message: "A manifest is plain data: it imports only src/shared/ and defineManifest (src/processes/manifest.ts), types included (the UI type-checks it).",
        }],
      }],
    },
  },
  {
    files: ["src/shared/*/manifest.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "^(?!\\.\\./[^.]|\\.\\./\\.\\./processes/manifest\\.js$)",
          message: "A manifest is plain data: it imports only src/shared/ and defineManifest (src/processes/manifest.ts), types included (the UI type-checks it).",
        }],
      }],
    },
  },
  // What a manifest reaches stays plain: the manifest contract and the two
  // type files it uses import only each other, src/shared/ and the process
  // model, types included, because the UI type-checks all of it.
  {
    files: ["src/processes/manifest.ts", "src/processes/descriptorTypes.ts", "src/db/schemaRequirement.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "^(?!\\./descriptorTypes\\.js$|\\.\\./db/schemaRequirement\\.js$|\\.\\./shared/|\\.\\./models/process\\.js$)",
          message: "The manifest contract imports only src/shared/, descriptorTypes, schemaRequirement and the process model (the UI type-checks it).",
        }],
      }],
    },
  },
  // A job is not a request handler: it returns a JobOutcome, so what it shares
  // with a controller lives in src/services/ or src/jobs/.
  {
    files: ["src/jobs/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "(^|/)controllers/",
          message: "A job is not a request handler: it returns a JobOutcome (src/jobs/types.ts). Move what both need into src/services/ or src/jobs/.",
        }],
      }],
    },
  },
  // The feed classifier is shared with the UI: its one import is the
  // manifest list (Architecture 2; it was import-free before).
  {
    files: ["src/shared/feedActivity.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "^(?!\\./processManifests\\.js$)",
          allowTypeImports: true,
          message: "feedActivity imports only the manifest list (src/shared/processManifests.ts).",
        }],
      }],
    },
  },
  {
    files: ["src/shared/processManifests.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          regex: "^(?!.*/manifest\\.js$|\\.\\./\\.\\./config/plugins/manifests\\.js$)",
          allowTypeImports: true,
          message: "The manifest list imports manifests (and the configured packages' list of them) and nothing else.",
        }],
      }],
    },
  },
];
