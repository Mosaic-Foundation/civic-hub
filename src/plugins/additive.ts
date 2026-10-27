// A package's migrations are additive only (plugin session 2, ADR-015).
//
// A deployment runs one version of each package for every hub, and every hub
// shares the database. A package's migrations run once for the whole database
// when a release applies them, before the code, as the hub's own do. So a
// migration must leave every existing row, column, table and function as it
// was: the code still running (the version before, during a release) and the
// open processes of every hub keep working on the migrated database.
// `npm run catalog:add` refuses a package with a migration that is not.
//
// What counts as not additive, statement by statement (comments and quoted
// strings are ignored):
//   DROP anything; RENAME anything; ALTER COLUMN … TYPE / SET DATA TYPE /
//   SET NOT NULL / DROP DEFAULT; TRUNCATE; DELETE; UPDATE (a migration that
//   rewrites rows changes what is there); REVOKE (it can take away what running
//   code uses); ADD CONSTRAINT without NOT VALID (it can refuse what old code
//   still writes); CREATE OR REPLACE of a function or view (it changes what
//   running code calls).
// Additive, among others: CREATE TABLE / INDEX / FUNCTION (new names), ALTER
// TABLE … ADD COLUMN (nullable or with a default), ADD CONSTRAINT … NOT VALID,
// COMMENT, GRANT, INSERT, and the hub's policy template
// (SELECT public._civic_apply_hub_policy(…)).
//
// A check of the text, not a parser: it refuses what it can see, and the
// conformance run and the operator's review stand behind it.
//
// And a table a migration makes must be granted to the hub's roles in that
// migration (`ungrantedTables`), as every hub migration does since
// 20260922000000: a hosted project's default privileges hide a missing GRANT,
// a local or CI stack's do not, and the plugin then fails with "permission
// denied" on its first write (the straw poll, found in CI).

export interface NotAdditive {
  file: string;
  statement: string;
  why: string;
}

const RULES: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /^\s*drop\b/i, why: "it drops something" },
  { re: /\balter\b[\s\S]*\bdrop\b/i, why: "it drops something" },
  { re: /\brename\b/i, why: "it renames something" },
  { re: /\balter\s+column\b[\s\S]*\b(type|set\s+data\s+type|set\s+not\s+null|drop\s+default)\b/i, why: "it changes an existing column" },
  { re: /^\s*truncate\b/i, why: "it empties a table" },
  { re: /^\s*delete\b/i, why: "it deletes rows" },
  { re: /^\s*update\b/i, why: "it rewrites rows" },
  { re: /^\s*revoke\b/i, why: "it takes a privilege away" },
  { re: /\badd\s+constraint\b(?![\s\S]*\bnot\s+valid\b)/i, why: "it adds a constraint existing rows and running code must meet (add it NOT VALID)" },
  { re: /^\s*create\s+or\s+replace\s+(function|view|procedure)\b/i, why: "it replaces a function or view running code calls (create one under a new name)" },
];

/** The SQL without comments, string literals and dollar-quoted bodies' contents, split into statements. */
export function statements(sql: string): string[] {
  const stripped = sql
    // Dollar-quoted bodies: keep a placeholder, so a function's own text is not read as statements.
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "$$$$")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
  return stripped
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Every statement of a migration that is not additive, and why. */
export function notAdditive(file: string, sql: string): NotAdditive[] {
  const out: NotAdditive[] = [];
  for (const statement of statements(sql)) {
    const rule = RULES.find((r) => r.re.test(statement));
    if (rule) out.push({ file, statement: statement.slice(0, 120), why: rule.why });
  }
  return out;
}

const ROLE_GUARD = "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN";

/** Every table a migration creates without granting it to service_role in the same file, with how to. */
export function ungrantedTables(file: string, sql: string): NotAdditive[] {
  const text = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: NotAdditive[] = [];
  for (const m of text.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    const table = m[1]!;
    const granted = new RegExp(`\\bgrant\\b[^;]*\\bon\\s+(?:table\\s+)?(?:public\\.)?"?${table}"?\\b[^;]*\\bto\\b[^;]*\\bservice_role\\b`, "i");
    if (granted.test(text)) continue;
    out.push({
      file,
      statement: m[0].replace(/\s+/g, " "),
      why:
        `it makes ${table} without granting it to the hub's roles; end the migration with ` +
        `DO $$ BEGIN ${ROLE_GUARD} GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated, service_role; END IF; END $$`,
    });
  }
  return out;
}
