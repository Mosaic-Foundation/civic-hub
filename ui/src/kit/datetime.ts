// The date-time control's conversions (engine 2, A7): an ISO instant to the
// browser's datetime-local value and back, in the reader's time zone. Apart
// from the components so the kit's component file exports only components.

/** An ISO instant as a datetime-local value, in the reader's time zone ("" for none). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value as an ISO instant (the reader's time zone), or null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
