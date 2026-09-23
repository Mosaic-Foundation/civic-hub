/**
 * Seed a hub's settings rows from the values this deployment already carries.
 *
 *   npx tsx scripts/seed-hub-settings.ts                # floyd, from env
 *   npx tsx scripts/seed-hub-settings.ts --hub athens   # the demo fixture
 *   npx tsx scripts/seed-hub-settings.ts --dry-run      # show, write nothing
 *
 * WHAT THIS IS FOR. Phase 1 part one moved the NAMES of these values to the
 * dotted scheme while they still lived in environment variables. This writes
 * them into hub_settings rows, which is what makes them per-hub: two hubs on
 * one deployment cannot have two values for one environment variable.
 *
 * IDEMPOTENT. Every write is an upsert on (hub_id, key), so running it twice
 * changes nothing the second time. Safe to rerun after adding a key.
 *
 * WHAT IT WILL NOT DO. It never invents a value for a key that has an
 * environment variable behind it. A key whose variable is unset is skipped
 * entirely, so a missing row keeps meaning "not configured" and keeps falling
 * back the way it did.
 *
 * The exceptions are the handful of keys that never had an environment
 * variable because their value lived inside a document as a literal —
 * `legal.operator_name`, `legal.contact_email`, `copy.welcome`. There is
 * nothing to fall back to for those, so this script is where the value is
 * stated. They are marked at the call site.
 *
 * NOT FOR PRODUCTION. Point it at a local stack or the dev project. The
 * production rows are written in the cutover session, by Adam, from the
 * runbook (BUILD-PLAN-multi-tenant.md → Phase 6).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../src/db/client.js";
import { KEYS } from "../src/models/hubSettings.js";
import { encodeList } from "../src/models/hubSettings.js";

type Entry = { key: string; value: string };

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const HUB_ID = (() => {
  const i = args.indexOf("--hub");
  return i >= 0 && args[i + 1] ? args[i + 1] : "floyd";
})();

/**
 * Turn a comma list of addresses into their `+athens` variants, so a demo
 * hub's admin is a distinct address that still reaches the same person.
 * Returns the example address when there is nothing to derive from.
 */
function plusAddressed(raw: string | undefined): string {
  const items = (raw ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"))
    .map((e) => {
      const [local, domain] = e.split("@");
      return `${local.split("+")[0]}+athens@${domain}`;
    });
  return items.length > 0 ? items.join(",") : "demo-admin@athens.example";
}

/** A file from the repo, or undefined when it is not there. */
function readLocalFile(relativePath: string): string | undefined {
  try {
    return readFileSync(resolve(process.cwd(), relativePath), "utf-8");
  } catch {
    console.warn(`  (skipping ${relativePath} — not found)`);
    return undefined;
  }
}

/** Trimmed env var, or undefined when unset or blank. */
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Add a row only when there is a real value. Absent stays absent. */
function put(out: Entry[], key: string, value: string | undefined): void {
  if (value !== undefined && value !== "") out.push({ key, value });
}

/** An env var holding a comma list, re-encoded as the JSON array we store. */
function putList(out: Entry[], key: string, raw: string | undefined): void {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length > 0) put(out, key, encodeList(items));
}

/**
 * Floyd: every per-hub value this deployment currently holds in env.
 *
 * The list mirrors the env-var table in BUILD-PLAN-multi-tenant.md. Anything
 * absent from the environment is absent here too.
 */
function floydEntries(): Entry[] {
  const out: Entry[] = [];

  // Floyd's proposal guide is its own document, not the shared one.
  //
  // The shared guide in config/legal/ is written to work anywhere: its worked
  // examples name no place. Floyd's version names the farmers market and the
  // town park, which is better writing FOR FLOYD and nonsense anywhere else.
  // So the specific version becomes Floyd's override and the generic one
  // stays the default that every other hub gets.
  put(
    out,
    KEYS.LEGAL_PROPOSAL_BEST_PRACTICES,
    readLocalFile("config/hubs/floyd/proposal-best-practices.md"),
  );

  // The welcome essay is Floyd's and only Floyd's — a personal introduction
  // naming a person, a county and 25 years of living there. There is no
  // shared version and there should not be one; another hub writes its own or
  // has none. It used to be compiled into the UI bundle, which is how Athens
  // came to serve it.
  put(out, KEYS.COPY_WELCOME, readLocalFile("config/hubs/floyd/welcome.md"));

  // Who is answerable for this hub and where to reach them. No env var has
  // ever held these — the values were written into the legal templates as
  // literals, which is what put Floyd's operator on Athens's terms page. They
  // are seeded rather than derived because there is nothing to derive them
  // from, and an unset operator is a legal document with a hole in it.
  put(out, KEYS.LEGAL_OPERATOR_NAME, "Adam Lake");
  put(out, KEYS.LEGAL_CONTACT_EMAIL, "contact@civic.social");

  put(out, KEYS.IDENTITY_NAME, env("HUB_NAME") ?? env("VITE_HUB_NAME"));
  put(out, KEYS.IDENTITY_LABEL, env("VITE_HUB_LABEL"));
  put(out, KEYS.IDENTITY_TAGLINE, env("VITE_HUB_TAGLINE"));
  put(out, KEYS.IDENTITY_PAGE_TITLE, env("VITE_HUB_PAGE_TITLE"));
  put(out, KEYS.IDENTITY_DESCRIPTION, env("VITE_HUB_DESCRIPTION"));
  put(out, KEYS.IDENTITY_BANNER_URL, env("VITE_HUB_BANNER_URL"));
  put(out, KEYS.IDENTITY_BANNER_ALT, env("VITE_HUB_BANNER_ALT"));
  put(out, KEYS.IDENTITY_THEME, env("VITE_HUB_THEME"));

  put(out, KEYS.COPY_INTRO_BODY, env("VITE_HUB_INTRO_BODY"));
  put(out, KEYS.COPY_RESIDENCY_INTRO, env("VITE_HUB_RESIDENCY_INTRO"));
  put(out, KEYS.COPY_GOVERNING_BODY_NAME, env("VITE_HUB_GOVERNING_BODY_NAME"));
  put(out, KEYS.COPY_GOVERNING_BODY_SHORT, env("VITE_HUB_GOVERNING_BODY_SHORT"));

  putList(out, KEYS.PEOPLE_ADMIN_EMAILS, env("CIVIC_ADMIN_EMAILS"));
  putList(out, KEYS.PEOPLE_BOARD_EMAILS, env("CIVIC_BOARD_EMAILS"));
  putList(out, KEYS.PEOPLE_BRIEF_RECIPIENTS, env("BOARD_RECIPIENT_EMAIL"));

  put(out, KEYS.EMAIL_FROM_ADDRESS, env("RESEND_FROM") ?? env("SMTP_FROM"));
  put(out, KEYS.EMAIL_POSTAL_ADDRESS, env("HUB_POSTAL_ADDRESS"));

  put(out, KEYS.PLUGIN_CONVERSATION_POLIS_URL,
      env("VITE_HUB_POLIS_URL") ?? env("POLIS_BASE_URL"));
  put(out, KEYS.PLUGIN_WORDCLOUD_ONBOARDING_ID,
      env("VITE_HUB_ONBOARDING_WORDCLOUD_ID"));
  putList(out, KEYS.PLUGIN_FEEDBACK_RECIPIENTS, env("FEEDBACK_RECIPIENT_EMAIL"));

  put(out, KEYS.PLUGIN_MEETING_SOURCE_URL, env("MEETING_SOURCE_URL"));
  put(out, KEYS.PLUGIN_MEETING_CONNECTOR_ID, env("MEETING_CONNECTOR_ID"));
  put(out, KEYS.PLUGIN_MEETING_EXTRACTION_INSTRUCTIONS,
      env("MEETING_EXTRACTION_INSTRUCTIONS"));
  put(out, KEYS.PLUGIN_MEETING_TITLE_FILTER, env("MEETING_TITLE_FILTER"));
  put(out, KEYS.PLUGIN_MEETING_TYPE_EXCLUDE, env("MEETING_TYPE_EXCLUDE"));
  put(out, KEYS.PLUGIN_MEETING_WIX_COLLECTION, env("MEETING_WIX_COLLECTION"));
  put(out, KEYS.PLUGIN_MEETING_YOUTUBE_CHANNEL_ID,
      env("MEETING_YOUTUBE_CHANNEL_ID"));
  put(out, KEYS.PLUGIN_MEETING_AUTO_PUBLISH, env("MEETING_SUMMARY_AUTO_PUBLISH"));
  put(out, KEYS.PLUGIN_MEETING_CUTOFF_DATE, env("MEETING_SUMMARY_CUTOFF_DATE"));
  put(out, KEYS.PLUGIN_MEETING_MAX_PER_RUN, env("MEETING_SUMMARY_MAX_PER_RUN"));

  put(out, KEYS.PLUGIN_NEWS_SYNC_SOURCE_URL, env("FLOYD_NEWS_SOURCE_URL"));
  put(out, KEYS.PLUGIN_NEWS_SYNC_MAX_PER_RUN, env("FLOYD_NEWS_SYNC_MAX_PER_RUN"));

  for (const [id, varName] of [
    ["digest", "DIGEST_ENABLED"],
    ["admin_digest", "ADMIN_DIGEST_ENABLED"],
    ["meeting_summary", "MEETING_SUMMARY_ENABLED"],
    ["news_sync", "FLOYD_NEWS_SYNC_ENABLED"],
  ] as const) {
    const v = env(varName);
    if (v !== undefined) {
      put(out, `plugin.${id}.enabled`, v === "false" ? "false" : "true");
    }
  }

  return out;
}

/**
 * Athens: the demo fixture. Deliberately different from Floyd in the places
 * the acceptance check looks — banner, About text, code of conduct, admin
 * roster — so that "the two hubs differ" is something you can see rather than
 * something you have to take on trust.
 *
 * Its code of conduct is an override: proof that a hub CAN author its own
 * document, on the one document where a short stand-in is obviously a
 * stand-in. The other three fall through to the shared templates and render
 * with Athens's own names substituted, which is the normal case.
 */
function athensEntries(): Entry[] {
  const out: Entry[] = [];

  put(out, KEYS.IDENTITY_NAME, "Athens Civic Hub");
  put(out, KEYS.IDENTITY_LABEL, "Civic Hub");
  put(out, KEYS.IDENTITY_TAGLINE,
      "A demonstration hub. Everything here is made up, and anyone may sign in and try it.");
  put(out, KEYS.IDENTITY_PAGE_TITLE, "Athens, VA — Civic Hub (demo)");
  put(out, KEYS.IDENTITY_DESCRIPTION,
      "A working demonstration of Civic.Social, set in the fictional Town of Athens, Virginia.");
  put(out, KEYS.IDENTITY_BANNER_URL, "/athens-banner.jpg");
  put(out, KEYS.IDENTITY_BANNER_ALT, "The Town of Athens, Virginia");

  put(out, KEYS.COPY_INTRO_BODY,
      "This is a demonstration hub. Look around, cast a vote, start a proposal — nothing here affects a real town.");
  put(out, KEYS.COPY_RESIDENCY_INTRO,
      "Athens is not a real town, so there is no residency to confirm. Review the policies below and carry on.");
  put(out, KEYS.COPY_GOVERNING_BODY_NAME, "Town Council");
  put(out, KEYS.COPY_GOVERNING_BODY_SHORT, "Council");
  put(out, KEYS.COPY_ABOUT,
      "## About the {HUB_NAME}\n\n" +
      "This is a demonstration of Civic.Social running for the fictional Town of Athens, Virginia. " +
      "Every process, vote and comment here is invented. Nothing is delivered to anyone, and no real " +
      "official reads it.\n\n" +
      "It exists so that a town considering a civic hub can see one working before deciding whether to " +
      "run their own. The software is the same software that runs the real hubs; only the contents are " +
      "made up.\n");

  // The one authored override, so the per-hub document path is exercised.
  put(out, KEYS.LEGAL_CODE_OF_CONDUCT,
      "# Code of Conduct\n\n" +
      "*This is a demonstration hub.*\n\n" +
      "The {HUB_NAME} is a demo. Nothing posted here reaches a real town council, and the " +
      "content is periodically cleared.\n\n" +
      "Be decent to anyone else who wanders in. Do not post anything you would not want kept, and " +
      "do not post anyone's personal information — not your own, and not anybody else's.\n\n" +
      "The real hubs run a considered Code of Conduct that moderates how things are said and not " +
      "what may be thought. This page stands in for it.\n");

  // Athens's admin has to be an address that can RECEIVE mail, because a
  // privileged account always gets a real emailed code — even on a demo hub.
  // An @athens.example admin could never sign in.
  //
  // So it is derived from this deployment's own admin by plus-addressing:
  // adam@example.com -> adam+athens@example.com. A different address, which
  // is what makes "an Athens admin is not a Floyd admin" visible, but one
  // that still reaches the same inbox. Override with CIVIC_ATHENS_ADMIN_EMAILS.
  putList(
    out,
    KEYS.PEOPLE_ADMIN_EMAILS,
    env("CIVIC_ATHENS_ADMIN_EMAILS") ?? plusAddressed(env("CIVIC_ADMIN_EMAILS")),
  );
  putList(out, KEYS.PEOPLE_BOARD_EMAILS, "demo-council@athens.example");

  // Athens is operated by a group, not a person — which is the case this
  // setting exists to cover, and the reason `legal.operator_name` is free
  // text rather than a name field.
  put(out, KEYS.LEGAL_OPERATOR_NAME, "Athens Moderator Group");
  put(out, KEYS.LEGAL_CONTACT_EMAIL, "athens@example.com");

  put(out, KEYS.EMAIL_FROM_NAME, "Athens Civic Hub (demo)");
  put(out, KEYS.EMAIL_FROM_ADDRESS, "Athens Civic Hub (demo) <demo@civic.social>");
  put(out, KEYS.EMAIL_POSTAL_ADDRESS, "1 Example Street, Athens, VA 24000");

  // A demo has nothing to deliver and nobody to mail.
  put(out, "plugin.digest.enabled", "false");
  put(out, "plugin.admin_digest.enabled", "false");
  put(out, "plugin.meeting_summary.enabled", "false");
  put(out, "plugin.news_sync.enabled", "false");

  return out;
}

/**
 * This script does not set a hub's mode, and cannot.
 *
 * `hubs.mode` is authoritative in the database and a trigger refuses any
 * update that moves a hub INTO demo, so a demo hub is created as one — Athens
 * comes out of supabase/seed.sql with `mode = 'demo'` — and everything else
 * moves between beta and live through the admin path, which requires a fresh
 * emailed code.
 *
 * Kept as a function so the intent is written down rather than merely absent:
 * if a future change wants to set a mode here, this comment is the argument
 * against it.
 */
function modeIsNotThisScriptsBusiness(): null {
  return null;
}

async function main(): Promise<void> {
  const db = getDb();

  const { data: hub, error: hubErr } = await db
    .from("hubs")
    .select("id, name, mode")
    .eq("id", HUB_ID)
    .maybeSingle();
  if (hubErr) throw new Error(`hubs lookup: ${hubErr.message}`);
  if (!hub) {
    throw new Error(
      `No hub "${HUB_ID}". Create the row first — Floyd comes from a migration, ` +
        `Athens from supabase/seed.sql.`,
    );
  }

  const entries = HUB_ID === "athens" ? athensEntries() : floydEntries();
  const mode = modeIsNotThisScriptsBusiness();

  console.log(`\nHub: ${HUB_ID} (${(hub as { name: string }).name})`);
  console.log(`Mode: ${(hub as { mode?: string }).mode ?? "?"} (set at creation; not changed here)`);
  console.log(`Settings to write: ${entries.length}\n`);
  for (const e of entries) {
    const shown = e.value.length > 68 ? `${e.value.slice(0, 68)}…` : e.value;
    console.log(`  ${e.key.padEnd(46)} ${shown.replace(/\n/g, "\\n")}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }
  if (entries.length === 0) {
    console.log("\nNothing to write — no values are configured.\n");
    return;
  }

  const rows = entries.map((e) => ({
    hub_id: HUB_ID,
    key: e.key,
    value: e.value,
    updated_by: "seed-hub-settings",
  }));
  const { error } = await db
    .from("hub_settings")
    .upsert(rows, { onConflict: "hub_id,key" });
  if (error) throw new Error(`upsert: ${error.message}`);

  console.log(`\nWrote ${rows.length} settings for "${HUB_ID}".\n`);
}

main().catch((e) => {
  console.error(`\nseed-hub-settings failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
