// Leaving demo, and going live: what must be in place first, and what the
// switch will do (leaving-demo slice, 2026-10-15).
//
// THE GOAL (Adam): a hub admin with no help from us takes a demo hub to beta,
// and later to live, and nothing surprises them or their residents on the
// way. So before Hub settings → Mode lets them switch, it shows:
//
//   1. a readiness list, each item with a link to where it is set. Two items
//      BLOCK until they are done (Adam, 2026-10-15): the time zone (a hub on
//      UTC sends its digests at the wrong hour and nobody notices) and a
//      postal address (outgoing email needs one in its footer). Every other
//      item may be accepted as it is, for this one switch; the acceptance is
//      recorded in the admin log entry for the mode change.
//   2. the consequences, in plain words and with real counts: who can sign in,
//      who the hub's email reaches, what happens to the notice, and that there
//      is no way back to demo.
//
// The same list applies to every switch up: demo → beta, demo → live and
// beta → live. Going back down, live → beta, has no list; its consequence is
// who gets locked out, and the page names how many.
//
// The server checks this again on the switch itself (hubModeController.ts),
// so the page is a view of the rule, not the rule.

import { currentHub } from "../config/hubContext.js";
import { forHub } from "../db/forHub.js";
import { readAll } from "../db/readAll.js";
import { currentHubId } from "../config/hubContext.js";
import { KEYS, asBoolean, asEmailList } from "../models/hubSettings.js";
import { hubKindOf } from "../shared/hubKind.js";
import type { HubMode } from "../models/hub.js";
import { DEFAULT_HUB_BANNER, PLATFORM_CONTACT_EMAIL } from "../shared/platform.js";
import { isValidTimeZone } from "../utils/hubTime.js";
import {
  effectivePostalAddressSync,
  getAdminEmailsSync,
  getAllSettings,
  getBoardEmailsSync,
  getSettingSync,
  hubDisplayNameSync,
  hubModeSync,
  isPluginEnabledSync,
} from "./hubSettings.js";
import { sampleContentSummary } from "./sampleContent.js";
import { listOfficials } from "./officials.js";
import { SETTINGS_SECTIONS } from "../shared/hubSettingsSections.js";
import { placeTimeZone, zonePlainName } from "../shared/hubTimeZone.js";

export type ReadinessItemId =
  | "name_and_place"
  | "timezone"
  | "postal_address"
  | "contact_email"
  | "second_admin"
  | "legal_reviewed"
  | "samples";

export interface ReadinessItem {
  id: ReadinessItemId;
  /** What must be in place, as a heading: "A postal address for the hub's email". */
  title: string;
  /** Where it stands now, in a sentence. */
  detail: string;
  done: boolean;
  /** Can't be accepted as it is: the switch waits until it is done. */
  blocking: boolean;
  /** The checkbox's words for accepting it as it is, when it may be. */
  accept_label?: string;
  /** Where in the hub it is set (a path). */
  link: string;
  link_label: string;
}

export interface ModeConsequences {
  /** One plain sentence per consequence, in the order the page lists them. */
  lines: string[];
  /** People on the waitlist who haven't been told the hub is open (→ live only). */
  waitlist_to_tell: number;
}

export interface ModeReadiness {
  from: HubMode;
  to: HubMode;
  /** Empty for a move that has no readiness list (live → beta, or no move). */
  items: ReadinessItem[];
  consequences: ModeConsequences;
}

/**
 * One line of the setup checklist (pilot readiness 3, Adam 2026-11-06): the
 * "Getting started" section first in Hub settings, and its first four on the
 * home page's "Set up your hub" card (pilot readiness 2).
 */
export interface SetupStep {
  id:
    | "name_and_place"
    | "banner"
    | "logo"
    | "theme"
    | "copy"
    | "legal"
    | "email"
    | "second_admin"
    | "officials"
    | "plugins"
    | "beta";
  label: string;
  /** What it is for, in a sentence, for the checklist. */
  hint: string;
  done: boolean;
  /** Ticked because this admin pressed Skip, not because it happened. */
  skipped: boolean;
  /** Offers Skip while it isn't done. */
  can_skip: boolean;
  /** Where in the hub it is set (a path). */
  link: string;
  /** Its page on docs.civic.social: a key of the help registry (src/shared/helpRegistry.json). */
  help: string;
}

/** How many of the checklist's first steps the home page's card shows. */
export const SETUP_CARD_STEPS = 4;

/**
 * Saved by a person on this hub, not written by creation or the console
 * (updated_by "start:…", "console:…"), which isn't this hub's admins having
 * looked.
 */
function savedByAdmin(rows: Record<string, { updated_by: string | null }>, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const by = rows[key]?.updated_by ?? null;
    return by !== null && !/^(start|console):/.test(by);
  });
}

const keysOf = (section: keyof typeof SETTINGS_SECTIONS) => SETTINGS_SECTIONS[section].map((f) => f.key);

/**
 * The whole checklist, read from the hub's state; every tick fills itself.
 * The sections that work as they ship (Appearance, Copy & pages, Plugins)
 * tick once an admin has saved them; Email needs only the sender's name (the
 * postal address is optional, and the platform's is used when it is empty).
 */
export async function setupChecklist(skippedSecondAdmin: boolean): Promise<SetupStep[]> {
  const hub = currentHub();
  const kindIsPlace = hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)) === "place";
  const named = hubDisplayNameSync().trim() !== "";
  const placed = !kindIsPlace || (hub?.jurisdiction_name?.trim() ?? "") !== "";
  const rows = await getAllSettings(currentHubId());
  const filled = (key: string) => (getSettingSync(key)?.trim() ?? "") !== "";
  const reviewed = asBoolean(getSettingSync(KEYS.LEGAL_REVIEWED), false);
  const twoAdmins = getAdminEmailsSync().length >= 2;
  const officials = (await listOfficials()).length > 0;
  const step = (id: SetupStep["id"], label: string, hint: string, done: boolean, link: string, help: string): SetupStep => ({
    id,
    label,
    hint,
    done,
    skipped: false,
    can_skip: false,
    link,
    help,
  });
  return [
    step(
      "name_and_place",
      kindIsPlace ? "Name and place set" : "Name set",
      "What the hub is called, on every page and in its emails, and its time zone.",
      // The zone too (Events 3, Adam): one inferred from the place ticks only once the admin confirms it.
      named && placed && filled(KEYS.IDENTITY_TIMEZONE),
      "/admin/settings/identity",
      "identity.name",
    ),
    // Every hub starts with the platform's banner; the tick is for the hub's own.
    step(
      "banner",
      "A banner image of your own",
      "The wide picture at the top of the home page.",
      filled(KEYS.IDENTITY_BANNER_URL) && getSettingSync(KEYS.IDENTITY_BANNER_URL)!.trim() !== DEFAULT_HUB_BANNER.url,
      "/admin/settings/identity",
      "identity.banner_url",
    ),
    step("logo", "A logo", "Beside the hub's name in the header and on shared links.", filled(KEYS.IDENTITY_LOGO_URL), "/admin/settings/identity", "identity.logo_url"),
    step("theme", "Appearance chosen", "Colours, font and how the sections are laid out.", savedByAdmin(rows, keysOf("theme")), "/admin/settings/theme", "settings.theme"),
    step("copy", "Copy and pages saved", "The welcome, the About page and the words people see first.", savedByAdmin(rows, keysOf("copy")), "/admin/settings/copy", "settings.copy"),
    step(
      "legal",
      "Legal reviewed or saved",
      "The Terms, Privacy Notice and Code of Conduct, and who runs the hub.",
      reviewed || savedByAdmin(rows, keysOf("legal")),
      "/admin/settings/legal",
      "settings.legal",
    ),
    step("email", "Email sender name set", "The name the hub's emails come from.", filled(KEYS.EMAIL_FROM_NAME), "/admin/settings/email", "email.from_name"),
    {
      ...step(
        "second_admin",
        "A second admin added",
        "Someone who can keep the hub running when you can't.",
        twoAdmins || skippedSecondAdmin,
        "/admin/settings/people",
        "people.admins",
      ),
      skipped: skippedSecondAdmin && !twoAdmins,
      can_skip: !twoAdmins,
    },
    step("officials", "Officials added", "The people your hub's results and briefs go to.", officials, "/admin/settings/officials", "settings.officials"),
    // Choosing means saving which plugins are on (Adam, 2026-11-06). A plugin's
    // own setting doesn't count: removing a sample saves the word cloud the
    // banner shows under the admin's name, which isn't choosing plugins.
    step(
      "plugins",
      "Plugins chosen",
      "Which kinds of participation the hub offers.",
      savedByAdmin(rows, keysOf("plugins").filter((k) => /^plugin\.[a-z_]+\.enabled$/.test(k))),
      "/admin/settings/plugins",
      "settings.plugins",
    ),
    step("beta", "Moved to beta", "Real sign-ins and real email, once the samples are gone.", hubModeSync() !== "demo", "/admin/settings/mode", "settings.mode"),
  ];
}

/** The home page's card: the checklist's first steps. */
export async function setupSteps(skippedSecondAdmin: boolean): Promise<SetupStep[]> {
  return (await setupChecklist(skippedSecondAdmin)).slice(0, SETUP_CARD_STEPS);
}

/** Moves that get the readiness list: every move up. */
export function needsReadiness(from: HubMode, to: HubMode): boolean {
  if (from === to) return false;
  return from === "demo" || (from === "beta" && to === "live");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

async function readinessItems(from: HubMode): Promise<ReadinessItem[]> {
  const hub = currentHub();
  const name = hubDisplayNameSync();
  const place = hub?.jurisdiction_name?.trim() ?? "";
  const items: ReadinessItem[] = [];

  items.push({
    id: "name_and_place",
    title: "The hub's name and place are right",
    detail: place
      ? `It is called ${name} and serves ${place}. The name is yours to change; the place is set by Civic.Social.`
      : `It is called ${name}. The name is yours to change.`,
    // Always a confirmation: nothing in the software can know they are right.
    done: false,
    blocking: false,
    accept_label: "They're right",
    link: "/admin/settings/identity",
    link_label: "Identity",
  });

  const tz = getSettingSync(KEYS.IDENTITY_TIMEZONE)?.trim() ?? "";
  const tzSet = tz !== "" && isValidTimeZone(tz);
  const placeZone = placeTimeZone(currentHub()?.jurisdiction_code ?? null);
  items.push({
    id: "timezone",
    title: "A time zone",
    detail: tzSet
      ? `Set to ${tz}. Digests go out at the hour you choose, in this zone.`
      : placeZone
        ? `Not confirmed: the hub uses ${zonePlainName(placeZone)} time, from its place. Confirm it or choose another.`
        : "Not set, so the hub runs on UTC and its digests go out at the wrong hour.",
    done: tzSet,
    blocking: true,
    link: "/admin/settings/identity",
    link_label: "Identity → Time zone",
  });

  const postal = effectivePostalAddressSync();
  items.push({
    id: "postal_address",
    title: "A postal address for the hub's email",
    detail: postal.value
      ? postal.source === "hub"
        ? "Set. It is printed in the footer of every digest."
        : "Using the platform's address. It is printed in the footer of every digest; you can give your own."
      : "None. Email law asks for a physical address in the footer of the hub's digests.",
    done: !!postal.value,
    blocking: true,
    link: "/admin/settings/email",
    link_label: "Email → Postal address",
  });

  const contact = getSettingSync(KEYS.LEGAL_CONTACT_EMAIL)?.trim() ?? "";
  items.push({
    id: "contact_email",
    title: "Your contact address",
    detail: contact
      ? `Set to ${contact}. The Terms, Privacy Policy, Code of Conduct and About page give it.`
      : `Not set, so the Terms, Privacy Policy, Code of Conduct and About page tell people to write to ${PLATFORM_CONTACT_EMAIL}, not to you.`,
    done: !!contact,
    blocking: false,
    accept_label: `Keep ${PLATFORM_CONTACT_EMAIL} for now`,
    link: "/admin/settings/legal",
    link_label: "Legal → Contact address",
  });

  const admins = getAdminEmailsSync().length;
  items.push({
    id: "second_admin",
    title: "A second admin",
    detail:
      admins >= 2
        ? `${plural(admins, "admin", "admins")}.`
        : "You are the only admin. If you lose access to your email, no one can run the hub.",
    done: admins >= 2,
    blocking: false,
    accept_label: "Just me for now",
    link: "/admin/settings/people",
    link_label: "Admins",
  });

  const reviewed = asBoolean(getSettingSync(KEYS.LEGAL_REVIEWED), false);
  items.push({
    id: "legal_reviewed",
    title: "The Terms and Privacy Policy reviewed",
    detail: reviewed
      ? "Marked as reviewed."
      : "They are shared starter text, not legal advice. Have someone qualified review them, then tick the box under Legal.",
    done: reviewed,
    blocking: false,
    accept_label: "Not yet; I'll have them reviewed",
    link: "/admin/settings/legal",
    link_label: "Legal",
  });

  if (from === "demo") {
    const s = await sampleContentSummary();
    const left = s.processes + s.added_in_demo;
    items.push({
      id: "samples",
      title: "The sample content removed",
      detail:
        left === 0
          ? "No sample content is left."
          : `${plural(s.processes, "sample process", "sample processes")}${
              s.added_in_demo > 0 ? ` and ${plural(s.added_in_demo, "item", "items")} visitors added` : ""
            } are still here. You can remove them with this switch, below.`,
      done: left === 0,
      blocking: false,
      accept_label: "Keep them for now",
      link: "/admin/settings/sample",
      link_label: "Sample content",
    });
  }
  return items;
}

/** Members who joined, not samples and not demo-only accounts (they can't sign in once demo ends). */
async function realMembers(): Promise<Array<{ email: string; digest_frequency_days: number | null }>> {
  // Paged: a hub can have more than 1,000 members (PostgREST's cap).
  return readAll((from, to) =>
    forHub(currentHubId())
      .from("users")
      .select<{ email: string; digest_frequency_days: number | null }>("email, digest_frequency_days")
      .eq("is_resident", true)
      .eq("is_sample", false)
      .eq("demo_only", false)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function demoOnlyCount(): Promise<number> {
  return forHub(currentHubId()).from("users").count().eq("demo_only", true).eq("is_sample", false);
}

async function waitlistUntold(): Promise<number> {
  return forHub(currentHubId()).from("waitlist").count().is("told_open_at", null);
}

async function consequences(from: HubMode, to: HubMode): Promise<ModeConsequences> {
  const lines: string[] = [];
  const admins = new Set(getAdminEmailsSync());
  const board = new Set(getBoardEmailsSync());
  const allowlist = new Set(asEmailList(getSettingSync(KEYS.BETA_ALLOWLIST)));
  const officials = await listOfficials();
  const briefTo = asEmailList(getSettingSync(KEYS.PEOPLE_BRIEF_RECIPIENTS));
  const members = await realMembers();
  const digestOn = isPluginEnabledSync("digest");
  const subscribers = digestOn ? members.filter((m) => m.digest_frequency_days !== null).length : 0;
  let waitlist_to_tell = 0;

  if (from === "demo") {
    const demoOnly = await demoOnlyCount();
    lines.push(
      demoOnly > 0
        ? `Everyone signs in with a real code from their email. The ${plural(demoOnly, "person", "people")} who looked around with "any six digits" ${demoOnly === 1 ? "is" : "are"} signed out and no longer counted as members; what they added stays.`
        : `Everyone signs in with a real code from their email. Anyone signed in with "any six digits" is signed out.`,
    );
  }

  if (to === "beta") {
    const entered = new Set([...admins, ...board, ...allowlist, ...officials.map((o) => o.email.toLowerCase())]);
    lines.push(
      allowlist.size > 0
        ? `Only admins, officials and the ${plural(allowlist.size, "address", "addresses")} on the allowlist can sign in. Anyone else is offered the waitlist.`
        : "Only admins and officials can sign in, because the allowlist is empty. Anyone else is offered the waitlist.",
    );
    if (from === "live") {
      const lockedOut = members.filter((m) => !entered.has(m.email.toLowerCase())).length;
      lines.push(
        lockedOut > 0
          ? `${plural(lockedOut, "member is", "members are")} on none of those lists. Once signed out, they can't sign back in, and the hub's email stops reaching them.`
          : "Every member is on one of those lists, so no one is locked out.",
      );
    }
    lines.push(
      `The hub's email (digests, briefs, notices) goes only to admins and the allowlist: ${plural(new Set([...admins, ...allowlist]).size, "address", "addresses")}. Officials are not emailed briefs until the hub is live.`,
    );
    lines.push(from === "demo" ? "The demo notice becomes the beta notice." : "The beta notice comes back on every page.");
  } else {
    lines.push("Anyone can sign in with a code sent to their email." + (from === "beta" ? " The allowlist no longer matters." : ""));
    const parts: string[] = [];
    if (digestOn) parts.push(`the participant digest to ${plural(subscribers, "member who gets", "members who get")} it`);
    if (isPluginEnabledSync("brief")) parts.push(`published briefs to ${plural(briefTo.length, "recipient", "recipients")} under Officials`);
    lines.push(
      parts.length > 0
        ? `Real email starts going to everyone it is addressed to: ${parts.join(", and ")}.`
        : "Real email starts going to everyone it is addressed to.",
    );
    lines.push(from === "demo" ? "The demo notice goes away." : "The beta notice goes away.");
    waitlist_to_tell = await waitlistUntold();
  }

  if (from === "demo") lines.push("There is no way back to demo, for you or for the platform.");
  else if (to === "live") lines.push("You can switch back to beta later, but members not on the allowlist would be locked out.");

  return { lines, waitlist_to_tell };
}

/** The readiness list and consequences for a move from the hub's mode to `to`. */
export async function modeReadiness(to: HubMode): Promise<ModeReadiness> {
  const from = hubModeSync();
  return {
    from,
    to,
    items: needsReadiness(from, to) ? await readinessItems(from) : [],
    consequences: from === to ? { lines: [], waitlist_to_tell: 0 } : await consequences(from, to),
  };
}

/**
 * Why a switch may not go ahead yet, or null when it may: a blocking item not
 * done, or an item neither done nor accepted. `samplesHandled` is true when the
 * admin chose to remove the samples with this switch.
 */
export function readinessRefusal(
  items: readonly ReadinessItem[],
  accepted: readonly string[],
  samplesHandled: boolean,
): string | null {
  const blocked = items.filter((i) => i.blocking && !i.done);
  if (blocked.length > 0) {
    return `Set these first: ${blocked.map((i) => i.title.toLowerCase()).join("; ")}.`;
  }
  const open = items.filter(
    (i) => !i.done && !accepted.includes(i.id) && !(i.id === "samples" && samplesHandled),
  );
  if (open.length > 0) {
    return `Finish or accept these first: ${open.map((i) => i.title.toLowerCase()).join("; ")}.`;
  }
  return null;
}
