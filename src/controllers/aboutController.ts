// About you (districts and demographics, Adam 2026-11-16): the signed-in
// member's own answers, and nobody else's.
//
//   GET  /user/about                  → { answers, asked }
//   PUT  /user/about                  { district_id?, birth_year?, race? } → { answers }
//   POST /user/about/asked            the one-time card was closed → { answers }
//   POST /user/about/district-lookup  { address } → { match, reason }
//   POST /user/about/address-suggestions { text } → { available, suggestions }
//
// Every route answers about the member in the session only. The address in
// a lookup is never stored or logged (src/services/districtLookup.ts).

import { route } from "../http/route.js";
import { getAuthUser } from "../middleware/auth.js";
import { currentAboutConfig, getAnswers, markAsked, saveAnswers } from "../modules/civic.about/index.js";
import { ensureCensusDistricts, lookUpDistrict, suggestAddresses } from "../services/districtLookup.js";
import { KEYS, getSetting } from "../services/hubSettings.js";
import { parseCensusDistricts } from "../shared/aboutYou.js";
import { currentHub, currentHubId } from "../config/hubContext.js";

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
 * POST /user/about/address-suggestions { text } → { available, suggestions }:
 * addresses matching what the member is typing (Mapbox, through the server).
 * A POST so the text is in no URL or access log; never stored.
 */
export const handleAddressSuggestions = route(async (req, res) => {
  const user = getAuthUser(res);
  res.set("Cache-Control", "no-store");
  const near = currentHub()?.jurisdiction_name?.trim() || null;
  res.json(await suggestAddresses(user.id, (req.body ?? {}).text, currentAboutConfig(), near));
});

/**
 * GET /admin/hub/districts/census (admins) → { districts: [{ id, name }] | null }:
 * the county's Census list the hub keeps (filling it first if it has none),
 * as Settings > Districts falls back to. Nothing the admin saves changes it.
 */
export const handleCensusDistricts = route(async (_req, res) => {
  const hubId = currentHubId();
  await ensureCensusDistricts(hubId);
  res.json({ districts: parseCensusDistricts(await getSetting(hubId, KEYS.ABOUT_CENSUS_DISTRICTS))?.districts ?? null });
});
