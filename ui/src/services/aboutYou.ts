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
 *
 * NOT DURING SIGN-UP (2026-11-18, Adam: the card opened on top of the
 * onboarding word cloud). A new account is not asked while it is still
 * signing up: the action that made it sign up, and everything on the
 * onboarding word cloud, go through without the card. It is first asked the
 * next time it takes part after that (holdAboutYouForSignup below). The
 * kernel names no package: the stop is whatever afterSignUpStop returned.
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
 * Held back after a sign-up. `action`: the one action that made them sign up
 * has not run yet. `stop`: the path of the first place a package sent the new
 * member (Word clouds: the onboarding word cloud), where nothing asks; kept
 * for this tab, so a reload of that page doesn't ask either. `reached`: they
 * have been there. Once they take part anywhere else after that, it is over.
 */
const STOP_KEY = "civic.aboutYou.signupStop";
let signupHold: { action: boolean; stop: string | null; reached: boolean } | null = loadStop();

function loadStop(): { action: boolean; stop: string | null; reached: boolean } | null {
  try {
    const stop = typeof window === "undefined" ? null : window.sessionStorage.getItem(STOP_KEY);
    return stop ? { action: false, stop, reached: true } : null;
  } catch {
    return null;
  }
}

function saveStop(stop: string | null): void {
  try {
    if (stop) window.sessionStorage.setItem(STOP_KEY, stop);
    else window.sessionStorage.removeItem(STOP_KEY);
  } catch {
    // No storage: the hold lasts for this page load only.
  }
}

/**
 * A new account just signed up (AuthModal). Call before login(), so the
 * action waiting on the sign-in is held too. `stop`: where a package is
 * sending them first (afterSignUpStop), or null.
 */
export function holdAboutYouForSignup(stop: string | null): void {
  const path = stop ? stop.split(/[?#]/)[0] : null;
  signupHold = { action: true, stop: path, reached: false };
  saveStop(path);
}

/** Whether this action still belongs to the sign-up; ends the hold once it doesn't. */
function heldForSignup(): boolean {
  const hold = signupHold;
  if (!hold) return false;
  const here = typeof window === "undefined" ? null : window.location.pathname;
  if (hold.stop && here === hold.stop) {
    hold.reached = true;
    hold.action = false;
    return true;
  }
  if (hold.action) {
    hold.action = false;
    if (!hold.stop) signupHold = null;
    return true;
  }
  if (hold.stop && !hold.reached) return true;
  signupHold = null;
  saveStop(null);
  return false;
}

/**
 * Wait for the one-time card if this member has not been asked yet; resolve
 * at once otherwise. Never rejects.
 */
export function askAboutYouFirst(): Promise<void> {
  const token = getStoredToken();
  if (!token || askedFor === token || !prompt) return Promise.resolve();
  // Still signing up: not now, and not recorded as asked.
  if (heldForSignup()) return Promise.resolve();
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
