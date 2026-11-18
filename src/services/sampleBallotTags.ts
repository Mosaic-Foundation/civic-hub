// District and age tags on a demo hub's sample ballots (Adam, 2026-11-17), so
// a demo shows "Results by District" and "Results by age group" on its
// closed sample vote without waiting for five real voters in a group.
//
// DEMO HUBS ONLY (hubs.mode = 'demo'): a beta or live hub's results are real
// people's, and nothing here may make a sample look like them. Sample ballots
// have no voter at all (no participation row, no person, no time), so a tag
// on one says nothing about anybody; the tags are the same coarse columns
// real ballots carry (tests/fixtures/ballotSecrecyRules.ts BALLOT_COLUMNS).
//
// The spread is fixed, so every demo looks alike: the last district gets 3
// ballots and the 75-and-over group 2, so each table shows one group as
// "Fewer than 5" next to groups that are counted.

import { randomUUID } from "node:crypto";
import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { hubModeSync } from "./hubSettings.js";
import { currentAboutConfig } from "../modules/civic.about/index.js";
import { sampleProcessId } from "../models/sampleContent.js";
import { sampleProcessIdsIn } from "./processRows.js";
import { AGE_BRACKETS, type AgeBracket } from "../shared/aboutYou.js";

export interface SampleBallotTag {
  district_id: string | null;
  age_bracket: AgeBracket | null;
}

const OLDEST: AgeBracket = "75+";
const COUNTED_AGES = AGE_BRACKETS.filter((a) => a !== OLDEST);
const FEW_IN_LAST_DISTRICT = 3;
const FEW_OLDEST = 2;

/** The tags for `count` sample ballots in a fixed spread over the hub's districts. Pure. */
export function sampleBallotTags(count: number, districtIds: readonly string[]): SampleBallotTag[] {
  const k = districtIds.length;
  const out: SampleBallotTag[] = [];
  for (let i = 0; i < count; i++) {
    let district: string | null = null;
    if (k === 1) district = districtIds[0]!;
    else if (k > 1) district = i < FEW_IN_LAST_DISTRICT ? districtIds[k - 1]! : districtIds[(i - FEW_IN_LAST_DISTRICT) % (k - 1)]!;
    const age = i < FEW_OLDEST ? OLDEST : COUNTED_AGES[(i - FEW_OLDEST) % COUNTED_AGES.length]!;
    out.push({ district_id: district, age_bracket: age });
  }
  return out;
}

/** The tags for a seed's sample ballots: the spread on a demo hub, none anywhere else. */
export function sampleBallotTagsForThisHub(count: number): SampleBallotTag[] {
  if (hubModeSync() !== "demo") return Array.from({ length: count }, () => ({ district_id: null, age_bracket: null }));
  return sampleBallotTags(count, currentAboutConfig().districts.map((d) => d.id));
}

/**
 * A demo hub's sample votes seeded before their ballots carried tags: give
 * those ballots the spread, so the closed sample vote shows its breakdowns.
 * Only a sample vote none of whose ballots has a tag is touched. Its ballots
 * are written again with the same choices, tagged, under new random receipts
 * (a sample ballot has no voter to hold one, and no code looks a ballot up by
 * receipt in a URL). Returns the template keys it tagged.
 */
export async function tagUntaggedSampleBallots(voteTemplateKeys: readonly string[]): Promise<string[]> {
  if (hubModeSync() !== "demo") return [];
  const districts = currentAboutConfig().districts.map((d) => d.id);
  const hubId = currentHubId();
  const db = forHub(hubId);
  const tagged: string[] = [];
  for (const key of voteTemplateKeys) {
    const processId = sampleProcessId(hubId, key);
    if ((await sampleProcessIdsIn([processId])).length === 0) continue;
    const rows = await db
      .from("vote_records")
      .select<{ choice: string; district_id: string | null; age_bracket: string | null }>("choice, district_id, age_bracket")
      .eq("process_id", processId);
    if (!rows?.length || rows.some((r) => r.district_id !== null || r.age_bracket !== null)) continue;
    const tags = sampleBallotTags(rows.length, districts);
    await db.from("vote_records").delete().eq("process_id", processId);
    await db.from("vote_records").insert(rows.map((r, i) => ({ receipt_id: randomUUID(), process_id: processId, choice: r.choice, ...tags[i]! })));
    tagged.push(key);
  }
  return tagged;
}
