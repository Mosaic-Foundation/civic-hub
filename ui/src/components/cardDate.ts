// The date on a process card (split from ProcessListCard.tsx).

/** "Sep 8" — the compact form the meta line uses for every date. */
export function cardDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
