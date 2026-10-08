// The start page's creator has just arrived (2026-10-08): the flag that
// shows HubReadyDialog once, in place of the visitor's popup.

import { markIntroSeen } from "../components/IntroPopup";

const FLAG = "civic_hub_just_created";

/** The creator has just arrived from the start page: show this once, and not the visitor's popup. */
export function markHubJustCreated(): void {
  markIntroSeen();
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    // No storage: the dialog is skipped, the email still arrives.
  }
}

export function hubJustCreated(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function clearHubJustCreated(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // Nothing to clear.
  }
}

/** Arriving with a handoff in the address (read before AuthContext strips it). */
export function arrivingFromStartPage(): boolean {
  return /^#handoff=/.test(window.location.hash);
}
