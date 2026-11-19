// A News item's feed card, built from its event's payload (moved out of the
// kernel's classifier, kernel step 3, Nov 19). Pure.

import type { Activity } from "@civic-social/plugin-sdk/manifest";
import { DEFAULT_NEWS_PILL } from "./models.js";

/**
 * A News item: its own filter and colour, the pill and "From" line its source
 * was given when it was copied in (the card's UI words both from the hub's
 * settings as they stand now; one source per hub), and a link to the original.
 */
export function newsCard(data: Record<string, unknown>, actionUrl: string): Activity {
  const source = ((data.news as { source?: unknown } | undefined)?.source ?? {}) as { label?: unknown; pill?: unknown };
  const pill = typeof source.pill === "string" && source.pill.trim() ? source.pill.trim() : DEFAULT_NEWS_PILL;
  const from = typeof source.label === "string" && source.label.trim() ? source.label.trim() : undefined;
  return { surface: "news", kind: "news", color: "news", pill, ...(from ? { from } : {}), href: actionUrl };
}
