// What happened to a message addressed to several people: who it was sent to,
// and who it was held back from on purpose.
//
// "Held back" is not "failed" (2026-10-07, review #34). A hub that is not live
// writes only to its admin roster and allow list (src/services/mailGuard.ts),
// and sample content is never delivered. Those are decisions, not errors: the
// brief or result still publishes, the record says who was not emailed and
// why, and the admin is told in plain words. A real send failure still throws.

export interface HeldBackRecipient {
  email: string;
  /** Why, as the end of a sentence: "this hub is in demo mode". */
  reason: string;
}

export interface DeliveryReport {
  sent: string[];
  held_back: HeldBackRecipient[];
}

/** The reason a mode guard gives, in words an admin reads. */
export function hubModeHoldReason(mode: string): string {
  return `this hub is in ${mode} mode`;
}

export const SAMPLE_HOLD_REASON = "this is sample content";

/** "A", "A and B", "A, B and C". */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The admin's confirmation after a brief or result is published, e.g.
 * "Published. Not emailed to the Board of Supervisors because this hub is in
 * demo mode." `sentNames` / `heldNames` are the display names to use (labels
 * when the admin chose recipients, addresses otherwise).
 */
export function publishedMessage(
  sentNames: readonly string[],
  held: { names: readonly string[]; reasons: readonly string[] },
): string {
  const parts = ["Published."];
  if (sentNames.length > 0) parts.push(`Emailed to ${joinWords(sentNames)}.`);
  if (held.names.length > 0) {
    const reasons = [...new Set(held.reasons)];
    parts.push(`Not emailed to ${joinWords(held.names)} because ${joinWords(reasons)}.`);
  }
  return parts.join(" ");
}
