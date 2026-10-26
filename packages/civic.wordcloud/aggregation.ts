// Word cloud aggregation — tokenize, stem, count single-word frequencies.

import { STOP_WORDS } from "./stopwords.js";
import type { CloudEntry } from "./models.js";

// --- Porter2 stemmer (lightweight, vendored) --------------------------------

function stem(word: string): string {
  if (word.length <= 3) return word;

  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s") && word.length > 3) {
    const base = word.slice(0, -1);
    if (base.length > 2) return base;
  }

  if (word.endsWith("edly") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("ingly") && word.length > 7) return word.slice(0, -5);
  if (word.endsWith("ing") && word.length > 5) {
    const base = word.slice(0, -3);
    if (base.endsWith("e")) return base;
    return base;
  }
  if (word.endsWith("ed") && word.length > 4) {
    const base = word.slice(0, -2);
    if (base.endsWith("e")) return base;
    if (base.length > 2) return base;
  }

  if (word.endsWith("ation") && word.length > 6) return word.slice(0, -5) + "ate";
  if (word.endsWith("tion") && word.length > 5) return word.slice(0, -4) + "t";
  if (word.endsWith("sion") && word.length > 5) return word.slice(0, -4) + "s";

  if (word.endsWith("ness") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ment") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ful") && word.length > 4) return word.slice(0, -3);
  if (word.endsWith("less") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ly") && word.length > 4) return word.slice(0, -2);

  return word;
}

// --- Tokenizer --------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/[-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && t !== "'");
}

// --- Public API -------------------------------------------------------------

export function extractWords(
  text: string,
): Array<{ display: string; stemmed: string }> {
  const raw = tokenize(text);
  return raw
    .filter((w) => !STOP_WORDS.has(w) && w.length > 1)
    .map((w) => ({ display: w, stemmed: stem(w) }));
}

export function aggregateSubmissions(
  bodies: string[],
  config: { display_threshold: number },
): CloudEntry[] {
  const index = new Map<
    string,
    { displayForms: Map<string, number>; submissionCount: number }
  >();

  for (const body of bodies) {
    const words = extractWords(body);
    const seen = new Set<string>();
    for (const { display, stemmed } of words) {
      if (seen.has(stemmed)) continue;
      seen.add(stemmed);

      let entry = index.get(stemmed);
      if (!entry) {
        entry = { displayForms: new Map(), submissionCount: 0 };
        index.set(stemmed, entry);
      }
      entry.submissionCount += 1;
      entry.displayForms.set(
        display,
        (entry.displayForms.get(display) ?? 0) + 1,
      );
    }
  }

  const entries: CloudEntry[] = [];
  for (const [, entry] of index) {
    if (entry.submissionCount < config.display_threshold) continue;

    let bestDisplay = "";
    let bestCount = 0;
    for (const [display, count] of entry.displayForms) {
      if (count > bestCount) {
        bestDisplay = display;
        bestCount = count;
      }
    }

    entries.push({ text: bestDisplay, count: entry.submissionCount });
  }

  entries.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  const MAX_CLOUD_ENTRIES = 50;
  return entries.slice(0, MAX_CLOUD_ENTRIES);
}
