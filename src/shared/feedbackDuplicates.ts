// Likely duplicates in Civic.Social's feedback inbox (feedback routing,
// 2026-10-15): items in the same stream, about the same page, whose words
// mostly overlap. A plain rule on purpose: it suggests, Civic.Social decides,
// and nothing about it needs a model or leaves the console.
//
// Pure. Shared by the console's API and its tests.

export interface DuplicateCandidate {
  id: string;
  created_at: string;
  stream: string;
  page_path: string | null;
  message: string;
}

/** Word overlap (Jaccard) at or above this is "similar text". */
export const SIMILARITY_THRESHOLD = 0.5;

const STOP_WORDS = new Set([
  "the", "and", "for", "but", "not", "with", "this", "that", "was", "are", "is", "it", "on", "in", "to", "of", "a",
  "an", "my", "me", "i", "when", "what", "can", "cant", "can't", "does", "doesnt", "doesn't", "dont", "don't", "there",
  "page", "just", "have", "has", "had", "you", "your", "its", "it's", "from", "they", "then", "than", "into", "would",
]);

/** The words that carry meaning: lowercased, three letters or more, no stop words. */
export function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

export function similarity(a: string, b: string): number {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/**
 * Group items into likely duplicates. Every item is in exactly one group;
 * an item with no page is always on its own. Groups keep the input's order
 * (the newest item first when the input is newest first), and so do the
 * items within each group.
 */
export function groupLikelyDuplicates<T extends DuplicateCandidate>(items: readonly T[]): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a.page_path) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (b.page_path !== a.page_path || b.stream !== a.stream) continue;
      if (similarity(a.message, b.message) >= SIMILARITY_THRESHOLD) {
        // The smaller index stays the root, so a group sits where its
        // earliest item is.
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }

  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(item);
    else groups.set(root, [item]);
  });
  // Map keeps insertion order, and every root is its group's earliest index.
  return [...groups.values()];
}
