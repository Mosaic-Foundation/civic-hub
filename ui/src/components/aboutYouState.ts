// The About-you form's state, and what it saves (districts and demographics).

import type { AboutInput } from "../services/aboutYou";
import type { AboutAnswers, AboutConfig } from "../../../src/shared/aboutYou";

const PREFER_NOT = "prefer_not";

export interface AboutFormState {
  /** A district id, "" (not answered) or "prefer_not". */
  district: string;
  /** A year, "" or "prefer_not". */
  birthYear: string;
  race: string[];
  racePreferNot: boolean;
}

export function formStateFrom(answers: AboutAnswers | null): AboutFormState {
  const declined = answers?.declined ?? [];
  return {
    district: declined.includes("district") ? PREFER_NOT : (answers?.district_id ?? ""),
    birthYear: declined.includes("birth_year") ? PREFER_NOT : answers?.birth_year ? String(answers.birth_year) : "",
    race: answers?.race ?? [],
    racePreferNot: declined.includes("race"),
  };
}

/** What to save: one key per question the hub asks. */
export function inputFrom(state: AboutFormState, config: AboutConfig): AboutInput {
  const out: AboutInput = {};
  if (config.questions.district) out.district_id = state.district || null;
  if (config.questions.birth_year) {
    out.birth_year = state.birthYear === PREFER_NOT ? PREFER_NOT : state.birthYear ? Number(state.birthYear) : null;
  }
  if (config.questions.race) out.race = state.racePreferNot ? PREFER_NOT : state.race.length ? state.race : null;
  return out;
}
