/** The order after moving one id from its place to `to` (kit SortableList). */
export function moveTo(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || to < 0 || to >= ids.length || from === to) return [...ids];
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}
