// About you (districts and demographics, Adam 2026-11-16): the signed-in
// member's own answers, and nobody else's.
//
//   GET  /user/about                  → { answers, asked }
//   PUT  /user/about                  { district_id?, birth_year?, race? } → { answers }
//   POST /user/about/asked            the one-time card was closed → { answers }
//   POST /user/about/district-lookup  { address } → { match, reason }
//
// Every route answers about the member in the session only. The address in
// a lookup is never stored or logged (src/services/districtLookup.ts).

import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import { currentAboutConfig, getAnswers, markAsked, saveAnswers } from "../modules/civic.about/index.js";
import { districtsFromCensus, lookUpDistrict } from "../services/districtLookup.js";
import { currentHubId } from "../config/hubContext.js";

export const handleGetAbout = route(async (_req, res) => {
  const user = getAuthUser(res);
  const answers = await getAnswers(user.id);
  res.json({ answers, asked: answers.asked_at !== null });
});

export const handlePutAbout = route(async (req, res) => {
  const user = getAuthUser(res);
  const answers = await saveAnswers(user.id, req.body ?? {}, currentAboutConfig());
  res.json({ answers });
});

export const handleAboutAsked = route(async (_req, res) => {
  const user = getAuthUser(res);
  res.json({ answers: await markAsked(user.id) });
});

export const handleDistrictLookup = route(async (req, res) => {
  const user = getAuthUser(res);
  res.set("Cache-Control", "no-store");
  res.json(await lookUpDistrict(user.id, (req.body ?? {}).address, currentAboutConfig()));
});

/**
 * GET /admin/hub/districts/census (admins) → { districts: [{ id, name }] | null }:
 * the hub's county's subdivisions from the Census, plainly named, for
 * Settings > Districts to fill in. Nothing is saved until the admin saves.
 */
export const handleCensusDistricts = route(async (_req, res) => {
  res.json({ districts: await districtsFromCensus(currentHubId()) });
});
