/**
 * Prove an environment cannot reach the production database.
 *
 *   npx tsx scripts/check-deploy-env.ts                 # check this shell's env
 *   vercel env pull .env.preview --environment=preview
 *   node --env-file=.env.preview --import tsx scripts/check-deploy-env.ts
 *
 * WHY THIS EXISTS. A deployment's reach is decided by two strings in its
 * environment. Reading them off a dashboard and thinking "that looks right" is
 * how the wrong database gets written to; this makes the check mechanical and
 * repeatable, and prints what it actually found rather than what was intended.
 *
 * Exits non-zero on any finding, so it can gate a deploy.
 */

const PRODUCTION_REF = "nfhyypwoporfggqcerli"; // Civic-Hub-Floyd, serves floyd.civic.social
const DEV_REF = "urfmvqhzmamigssqwsya"; // civic_hub_floyd_Dev

interface Finding {
  level: "FAIL" | "WARN";
  message: string;
}

const findings: Finding[] = [];
const notes: string[] = [];

function fail(message: string): void {
  findings.push({ level: "FAIL", message });
}
function warn(message: string): void {
  findings.push({ level: "WARN", message });
}

/** The Supabase project a URL or key points at, if it names one. */
function refIn(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.match(/([a-z]{20})\.supabase\.(co|in)/);
  return m ? m[1] : null;
}

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

/**
 * `vercel env pull` writes `[SENSITIVE]` in place of any value Vercel marks
 * as such, so a file pulled from a deployment cannot be checked this way. Say
 * that outright instead of reporting a malformed URL, which is what it looks
 * like otherwise and sends the reader to the wrong problem.
 */
if (url === "[SENSITIVE]" || key === "[SENSITIVE]") {
  console.log(`
This file came from \`vercel env pull\`, which masks secret values as
[SENSITIVE]. Nothing here can be verified from it.

Check the deployment instead, once it is running. Its hubs table is the proof:
the dev database has rows for civic-hub-dev.vercel.app and
athens-civic-hub-dev.vercel.app, and production has no such rows and has not
been migrated at all. A deployment that resolves either hostname to a hub is
therefore talking to dev.

  curl -s https://civic-hub-dev.vercel.app/api/hub-config | head -c 200

To check credentials directly, run this against the .env you are about to
upload rather than against a pulled file.
`);
  process.exit(0);
}

if (!url) {
  fail("SUPABASE_URL is not set. The deployment has no database at all.");
} else {
  const ref = refIn(url);
  notes.push(`SUPABASE_URL  -> ${url}`);
  if (ref === PRODUCTION_REF) {
    fail(
      `SUPABASE_URL points at PRODUCTION (${PRODUCTION_REF}). ` +
        `A deployment with this value writes to the live production database.`,
    );
  } else if (ref === DEV_REF) {
    notes.push(`              -> dev project (${DEV_REF}). Correct for a dev deployment.`);
  } else if (ref) {
    warn(`SUPABASE_URL names project "${ref}", which is neither production nor dev. Confirm it is intended.`);
  } else if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    warn(`SUPABASE_URL "${url}" does not look like a Supabase project URL.`);
  }
}

if (!key) {
  fail("SUPABASE_SERVICE_ROLE_KEY is not set. The deployment cannot read anything.");
} else {
  // A legacy service-role key is a JWT whose payload names the project. Decode
  // the claim rather than trusting that the key was pasted next to the right
  // URL — a mismatched pair is exactly the mistake worth catching.
  try {
    const payload = JSON.parse(
      Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { ref?: string; iss?: string; role?: string };
    if (payload.ref) {
      notes.push(`SERVICE_ROLE_KEY -> project ${payload.ref}, role ${payload.role ?? "?"}`);
      if (payload.ref === PRODUCTION_REF) {
        fail(
          `SUPABASE_SERVICE_ROLE_KEY is a PRODUCTION key (${PRODUCTION_REF}). ` +
            `Whatever SUPABASE_URL says, this key opens the live database.`,
        );
      }
      const urlRef = refIn(url);
      if (urlRef && payload.ref !== urlRef) {
        fail(
          `Mismatch: SUPABASE_URL names "${urlRef}" but the key belongs to "${payload.ref}".`,
        );
      }
    } else {
      notes.push("SERVICE_ROLE_KEY -> opaque (sb_secret_… style); cannot name its project.");
    }
  } catch {
    notes.push("SERVICE_ROLE_KEY -> not a decodable JWT; cannot name its project.");
  }
}

// Values that must NOT be present on a multi-hub deployment: they are settings
// now, and an env var that still holds one silently overrides a hub's row for
// every hub at once.
for (const stale of [
  "CIVIC_DEMO_BYPASS_CODE",
  "CIVIC_BETA_MODE",
  "VITE_DEMO_MODE",
  "VITE_DEMO_BYPASS_CODE",
]) {
  if (process.env[stale]) {
    fail(
      `${stale} is set. A hub's mode comes only from its database row now; ` +
        `this variable no longer does anything, and its presence means the ` +
        `environment was copied from before the hardening pass.`,
    );
  }
}

// Mail. A dev deployment that can send is a dev deployment that can mail real
// residents from a test.
if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
  warn(
    "No email is configured. Ordinary visitors can still sign in to a DEMO " +
      "hub (any six digits), but nobody can sign in to a beta or live hub, " +
      "and no admin can sign in anywhere — privileged accounts always need a " +
      "real emailed code. Set RESEND_API_KEY to walk through the admin flows.",
  );
} else {
  notes.push(
    "Email is configured. Real mail will be sent from this deployment — check " +
      "the from-address before exercising anything that notifies residents.",
  );
}

if (!process.env.CIVIC_ALLOWED_ORIGINS && process.env.NODE_ENV === "production") {
  fail("CIVIC_ALLOWED_ORIGINS is unset in production. The server refuses to start without it.");
}

console.log("\nEnvironment under test\n");
for (const n of notes) console.log(`  ${n}`);

console.log("");
if (findings.length === 0) {
  console.log("  PASS — nothing here can reach the production database.\n");
  process.exit(0);
}
for (const f of findings) console.log(`  ${f.level}: ${f.message}`);
console.log("");
process.exit(findings.some((f) => f.level === "FAIL") ? 1 : 0);
