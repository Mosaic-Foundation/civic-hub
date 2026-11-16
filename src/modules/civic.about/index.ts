// civic.about module — a member's own "About you" answers (districts and
// demographics, Adam 2026-11-16; src/shared/aboutYou.ts).
//
// THE PROMISE: only the member sees their answers. Nothing here serves one
// person's answers to anyone else: the routes answer the signed-in member
// about themselves, the ballot tags are coarse (a district, an age group,
// race only if the hub asks) and carry no person, and the breakdowns
// (src/services/breakdowns.ts) read answers only to count them, hiding any
// group under five. Plugins never receive answers (the SDK exports the
// breakdowns, not this module).
//
// Asked once: `asked_at` is set the first time the member sees the card or
// saves in Settings, whatever they answer, and the card never shows again.

import { ValidationError } from "../../errors/index.js";
import {
  ABOUT_QUESTIONS,
  BIRTH_YEAR_MIN,
  EMPTY_ANSWERS,
  MIN_AGE,
  RACE_IDS,
  ageBracket,
  aboutConfig,
  type AboutAnswers,
  type AboutConfig,
  type AboutQuestion,
  type AgeBracket,
} from "../../shared/aboutYou.js";
import { getSettingSync } from "../../services/hubSettings.js";
import { aboutStore, type MemberAboutRow } from "./store.js";

/** The hub in scope's About-you settings: the words, the districts, which questions are on. */
export function currentAboutConfig(): AboutConfig {
  return aboutConfig((key) => getSettingSync(key));
}

function toAnswers(row: MemberAboutRow | null): AboutAnswers {
  if (!row) return { ...EMPTY_ANSWERS };
  return {
    district_id: row.district_id ?? null,
    birth_year: typeof row.birth_year === "number" ? row.birth_year : null,
    race: Array.isArray(row.race) ? [...row.race] : [],
    declined: (Array.isArray(row.declined) ? row.declined : []).filter((q): q is AboutQuestion =>
      (ABOUT_QUESTIONS as readonly string[]).includes(q),
    ),
    asked_at: row.asked_at ?? null,
  };
}

/** The signed-in member's own answers (empty when they have none). */
export async function getAnswers(userId: string): Promise<AboutAnswers> {
  return toAnswers(await aboutStore.get().get(userId));
}

/**
 * Record that the member has been asked, without changing any answer: the
 * card was closed or skipped. Asked once, so a second call changes nothing.
 */
export async function markAsked(userId: string, now: Date = new Date()): Promise<AboutAnswers> {
  const current = await aboutStore.get().get(userId);
  if (current?.asked_at) return toAnswers(current);
  const row: MemberAboutRow = {
    ...(current ?? { user_id: userId, district_id: null, birth_year: null, race: [], declined: [] }),
    user_id: userId,
    asked_at: now.toISOString(),
  };
  await aboutStore.get().put(row);
  return toAnswers(row);
}

/** What a member may send: each answer, or "prefer_not" for "Prefer not to say". Absent keys are left as they are. */
export interface AnswersInput {
  district_id?: unknown;
  birth_year?: unknown;
  race?: unknown;
}

const PREFER_NOT = "prefer_not";

/**
 * Save the member's answers. Each key present replaces that answer: a value,
 * null (clear it) or "prefer_not". Questions the hub does not ask are
 * refused, so an answer is never kept for a question nobody asked. Sets
 * `asked_at` if it was not set.
 */
export async function saveAnswers(
  userId: string,
  input: AnswersInput,
  config: AboutConfig = currentAboutConfig(),
  now: Date = new Date(),
): Promise<AboutAnswers> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Send your answers as an object.");
  }
  const current = toAnswers(await aboutStore.get().get(userId));
  const next: AboutAnswers = { ...current, race: [...current.race], declined: [...current.declined] };
  const decline = (q: AboutQuestion, on: boolean) => {
    next.declined = next.declined.filter((d) => d !== q);
    if (on) next.declined.push(q);
  };

  if ("district_id" in input) {
    const v = input.district_id;
    if (!config.questions.district && v !== null) throw new ValidationError("This hub does not ask for a district.", "question_off");
    if (v === null || v === "") {
      next.district_id = null;
      decline("district", false);
    } else if (v === PREFER_NOT) {
      next.district_id = null;
      decline("district", true);
    } else if (typeof v === "string" && config.districts.some((d) => d.id === v)) {
      next.district_id = v;
      decline("district", false);
    } else {
      throw new ValidationError("That is not one of this hub's districts.", "unknown_district");
    }
  }

  if ("birth_year" in input) {
    const v = input.birth_year;
    if (!config.questions.birth_year && v !== null) throw new ValidationError("This hub does not ask for a year of birth.", "question_off");
    const latest = now.getUTCFullYear() - MIN_AGE;
    if (v === null || v === "") {
      next.birth_year = null;
      decline("birth_year", false);
    } else if (v === PREFER_NOT) {
      next.birth_year = null;
      decline("birth_year", true);
    } else {
      const year = typeof v === "string" ? Number.parseInt(v, 10) : v;
      if (typeof year !== "number" || !Number.isInteger(year) || year < BIRTH_YEAR_MIN || year > latest) {
        throw new ValidationError(`Enter a year of birth between ${BIRTH_YEAR_MIN} and ${latest}.`, "bad_birth_year");
      }
      next.birth_year = year;
      decline("birth_year", false);
    }
  }

  if ("race" in input) {
    const v = input.race;
    if (!config.questions.race && v !== null && !(Array.isArray(v) && v.length === 0)) {
      throw new ValidationError("This hub does not ask about race or ethnicity.", "question_off");
    }
    if (v === null) {
      next.race = [];
      decline("race", false);
    } else if (v === PREFER_NOT) {
      next.race = [];
      decline("race", true);
    } else if (Array.isArray(v) && v.every((r) => typeof r === "string" && RACE_IDS.includes(r))) {
      next.race = RACE_IDS.filter((id) => v.includes(id));
      decline("race", false);
    } else {
      throw new ValidationError("Choose from the listed options.", "unknown_race");
    }
  }

  next.asked_at = current.asked_at ?? now.toISOString();
  await aboutStore.get().put({
    user_id: userId,
    district_id: next.district_id,
    birth_year: next.birth_year,
    race: next.race,
    declined: next.declined,
    asked_at: next.asked_at,
  });
  return next;
}

// --- Coarse tags, for ballots and totals ---------------------------------------------

/** The coarse groups a member is counted in. Each null means "Not provided". */
export interface MemberTags {
  district_id: string | null;
  age_bracket: AgeBracket | null;
  /** Only when the hub asks about race; otherwise null. */
  race: string[] | null;
}

const NO_TAGS: MemberTags = { district_id: null, age_bracket: null, race: null };

/**
 * A member's answers reduced to the groups results are counted by, at `now`:
 * a district still on the hub's list, an age group (never the year), race
 * only if the hub asks. A question switched off contributes nothing.
 */
export function tagsFrom(answers: AboutAnswers | null, config: AboutConfig, now: Date = new Date()): MemberTags {
  if (!answers) return { ...NO_TAGS };
  const district =
    config.questions.district && answers.district_id && config.districts.some((d) => d.id === answers.district_id)
      ? answers.district_id
      : null;
  return {
    district_id: district,
    age_bracket: config.questions.birth_year ? ageBracket(answers.birth_year, now) : null,
    race: config.questions.race && answers.race.length > 0 ? [...answers.race] : null,
  };
}

/** One member's tags on the hub in scope (for the ballot they are casting). */
export async function tagsForMember(userId: string, now: Date = new Date()): Promise<MemberTags> {
  const config = currentAboutConfig();
  if (!config.questions.district && !config.questions.birth_year && !config.questions.race) return { ...NO_TAGS };
  return tagsFrom(toAnswers(await aboutStore.get().get(userId)), config, now);
}

/**
 * Many members' tags, for counting them. Returned as a list in no particular
 * order and without the member's id, so nothing downstream can hand one
 * person's answers on.
 */
export async function tagsForMembers(userIds: readonly string[], now: Date = new Date()): Promise<MemberTags[]> {
  const config = currentAboutConfig();
  const unique = [...new Set(userIds)];
  const rows = unique.length ? await aboutStore.get().forUsers(unique) : [];
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  return unique.map((id) => tagsFrom(byUser.has(id) ? toAnswers(byUser.get(id)!) : null, config, now));
}
