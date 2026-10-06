// Date formatting shared by components. Kept out of component files so they
// export only components (react-refresh/only-export-components).

/** "September 25, 2026": a date with no time, for receipts (2026-10-06). */
export function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
