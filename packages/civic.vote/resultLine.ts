// A closed vote's final count as one line, for its feed card and the digest's
// row (the handler's resultLine, kernel step 3). Pure: the server and the
// package's UI both read it.

/**
 * One line of a vote's final count for a card or digest row, most votes
 * first: "Yes 12 · No 5 · Unsure 1". Empty when the event carries no tally
 * or nobody voted.
 * Options are stored by their label, so the keys read as written.
 */
export function voteResultLine(data: Record<string, unknown> | undefined): string {
  const result = (data?.result ?? {}) as { tally?: unknown };
  const tally = result.tally;
  if (!tally || typeof tally !== "object") return "";
  const counts = Object.entries(tally as Record<string, unknown>).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
  if (counts.every(([, n]) => n === 0)) return "";
  return counts
    .sort((a, b) => b[1] - a[1])
    .map(([option, count]) => `${option} ${count}`)
    .join(" · ");
}
