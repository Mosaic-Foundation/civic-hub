// Share metadata — what a social-media crawler should see for one page.
//
// UNIVERSAL. The Vercel OG function (api/og.ts) used to hand-enumerate
// page kinds (process, proposal, project, deliberation, …) and forgot
// /brief — so a shared brief rendered as the generic hub card. Now every
// public detail page resolves the same way: the id in the path is looked
// up as a process, its handler's detailPath must agree with the section
// the link used, and the preview is built from the row (title,
// description, first `*image_url`) unless the handler's `describeShare`
// says otherwise. A type registered tomorrow is shareable the moment it
// has a detailPath.

import type { Process } from "../models/process.js";
import type { ShareMeta } from "../processes/types.js";
import { getProcessHandler, processDetailPath } from "../processes/registry.js";
import { isPubliclyFetchable } from "./processLifecycle.js";

const MAX_DESCRIPTION = 200;

/** `/section/id` → { section, id }; anything else → null. */
export function parseDetailPath(pathname: string): { section: string; id: string } | null {
  const clean = pathname.split("?")[0].split("#")[0];
  const segments = clean.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [section, id] = segments;
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  return { section, id };
}

/** First `*image_url` string found on state, state.content, or content. */
export function findShareImage(process: Process): string | null {
  const bags: unknown[] = [
    process.state,
    (process.state as { content?: unknown } | null)?.content,
    process.content,
  ];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
      if (/image_url$/.test(key) && typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function trimDescription(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_DESCRIPTION) return oneLine;
  const cut = oneLine.slice(0, MAX_DESCRIPTION);
  const atWord = cut.lastIndexOf(" ");
  return `${cut.slice(0, atWord > 120 ? atWord : MAX_DESCRIPTION).trimEnd()}…`;
}

/**
 * Pure: the preview for one loaded process, or null when the page is not
 * shareable — not public, still pending publication, or reached through a
 * section that is not this type's own detail path.
 */
export function buildShareMeta(pathname: string, process: Process): ShareMeta | null {
  const parsed = parseDetailPath(pathname);
  if (!parsed || parsed.id !== process.id) return null;

  const type = process.definition.type;
  const canonical = processDetailPath(type, process.id);
  if (canonical !== `/${parsed.section}/${parsed.id}`) return null;

  if (!isPubliclyFetchable(process.status)) return null;
  // Records with a publication workflow (briefs, vote results) are public
  // only once published. The field name is a shared convention.
  const pub = (process.state as { publication_status?: unknown } | null)?.publication_status;
  if (typeof pub === "string" && pub !== "published") return null;

  const override = getProcessHandler(type)?.describeShare?.(process);
  if (override === null) return null;

  const title = (override?.title ?? process.title ?? "").trim();
  if (!title) return null;
  const description = trimDescription(override?.description ?? process.description ?? "") || title;
  const image = override?.image !== undefined ? override.image : findShareImage(process);

  return { title, description, image, path: canonical };
}
