// The public brief's delivery lines, shared by the brief page and the
// pointer on its source's page. Names and titles only, never an address.

import type { PublicBrief } from "./api";
import { absoluteDate } from "../utils/dates";

/** "A" / "A and B" / "A, B, and C": the receipt reads as a sentence. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Who the brief was addressed to but not emailed, and why: "Addressed to
 * Test BoS on October 13, 2026 (not emailed: this hub is in demo mode)."
 * A demo or beta hub holds its email back; the page says so rather than
 * claim it was sent or say nothing (Adam, 2026-10-13). Null when nothing
 * was held back.
 */
export function heldBackLine(brief: PublicBrief): string | null {
  const names = brief.addressed_to ?? [];
  if (names.length === 0 || !brief.approved_at) return null;
  const why = brief.not_sent_because ? ` (not emailed: ${brief.not_sent_because})` : " (not emailed)";
  return `Addressed to ${joinNames(names)} on ${absoluteDate(brief.approved_at)}${why}.`;
}
