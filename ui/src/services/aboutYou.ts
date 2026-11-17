/**
 * About you (districts and demographics, 2026-11-16): the member's own
 * answers, and the one-time ask before they first take part.
 *
 * askAboutYouFirst() is awaited by every api.ts call that takes part in
 * something (a vote, a support, a comment, a submission, a word cloud answer,
 * a conversation). The first time a signed-in member does one on a hub that
 * asks anything, it waits while the card (AboutYouCard, mounted once in App)
 * is shown, then lets the action go on, whatever they answered. The server
 * records that they were asked, so the card never shows again, on any device.
 * It never blocks an action: any failure here just lets the action through.
 */

import { request } from "./http";
import { getStoredToken } from "./tokenStore";
import { setting } from "../config/hubConfig";
import { aboutConfig, asksAnything, type AboutAnswers, type District } from "../../../src/shared/aboutYou";

export interface AboutResponse {
  answers: AboutAnswers;
  asked: boolean;
}

/** What a save may send: an answer, null to clear it, or "prefer_not". */
export interface AboutInput {
  district_id?: string | null;
  birth_year?: number | "prefer_not" | null;
  race?: string[] | "prefer_not" | null;
}

export function getAbout(): Promise<AboutResponse> {
  return request("GET", "/user/about");
}

export function saveAbout(input: AboutInput): Promise<{ answers: AboutAnswers }> {
  return request("PUT", "/user/about", input);
}

export function markAboutAsked(): Promise<{ answers: AboutAnswers }> {
  return request("POST", "/user/about/asked");
}

export interface DistrictLookup {
  match: District | null;
  reason: "not_found" | "no_match" | "unavailable" | null;
}

/** The address goes to the hub once, and from there once to the Census Bureau; neither keeps it. */
export function lookUpDistrict(address: string): Promise<DistrictLookup> {
  return request("POST", "/user/about/district-lookup", { address });
}

/**
 * Addresses matching what the member is typing. Through the hub, which asks
 * Mapbox with the text alone; neither keeps it. `available` false: this hub
 * has no suggestions, keep to Find.
 */
export function suggestAddresses(text: string): Promise<{ available: boolean; suggestions: string[] }> {
  return request("POST", "/user/about/address-suggestions", { text });
}

/** The hub in view's About-you settings. */
export function currentAboutConfig() {
  return aboutConfig((key) => setting(key));
}

type Prompt = () => Promise<void>;
let prompt: Prompt | null = null;
/** The session token the member was asked under (or found already asked). */
let askedFor: string | null = null;
let pending: Promise<void> | null = null;

/** AboutYouCard registers how to show itself; null when it unmounts. */
export function setAboutYouPrompt(fn: Prompt | null): void {
  prompt = fn;
}

/** Note that this session's member has been asked (Settings saved, or the card shown). */
export function noteAboutAsked(): void {
  askedFor = getStoredToken();
}

/**
 * Wait for the one-time card if this member has not been asked yet; resolve
 * at once otherwise. Never rejects.
 */
export function askAboutYouFirst(): Promise<void> {
  const token = getStoredToken();
  if (!token || askedFor === token || !prompt) return Promise.resolve();
  if (!asksAnything(currentAboutConfig())) return Promise.resolve();
  if (!pending) {
    pending = (async () => {
      try {
        const me = await getAbout();
        if (!me.asked && prompt) await prompt();
        askedFor = token;
      } catch {
        // Never stand between a member and what they came to do.
      } finally {
        pending = null;
      }
    })();
  }
  return pending;
}
