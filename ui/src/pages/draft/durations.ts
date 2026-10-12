// The duration picker's choices, as the confirmation names them. One table
// for every drafting kind (it was copied into three pages).

const DAY_MS = 24 * 60 * 60 * 1000;

const LABELS: Record<number, string> = {
  [14 * DAY_MS]: "2 weeks",
  [30 * DAY_MS]: "1 month",
  [42 * DAY_MS]: "6 weeks",
  [60 * DAY_MS]: "2 months",
  [90 * DAY_MS]: "3 months",
};

/** "6 weeks", or "<n> days" for a duration the picker does not offer. */
export function durationLabel(ms: number, extra: Record<number, string> = {}): string {
  return extra[ms] ?? LABELS[ms] ?? `${Math.round(ms / DAY_MS)} days`;
}

export { DAY_MS };
