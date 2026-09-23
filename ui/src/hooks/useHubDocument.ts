import { useEffect, useState } from "react";
import {
  loadHubDocuments,
  loadedDocument,
  type DocumentKey,
} from "../config/hubDocuments";

/**
 * A hub's version of a document — terms, privacy, the code of conduct, the
 * welcome essay.
 *
 * THERE IS NO BUNDLED FALLBACK, as of 2026-09-23. There used to be: each page
 * imported a copy of the document with Vite's `?raw` and rendered it until the
 * hub's own arrived. That was safe while one deployment served one hub, and
 * became a leak the moment two shared a build — Athens rendered Floyd's terms,
 * naming Floyd's operator, Floyd's address and Floyd's domain, as a legal
 * statement about Athens. Showing nothing is better than showing a document
 * about somebody else: a visitor who sees "not available" asks; a visitor who
 * sees the wrong terms believes them.
 *
 * So the three states are real states and each page renders all three. The
 * shared templates in config/legal/ mean "missing" is rare — a hub gets those
 * with its own names substituted without configuring anything — and it is
 * honest when it happens.
 */
export type HubDocument =
  | { status: "loading" }
  | { status: "ready"; markdown: string }
  | { status: "missing" };

export function useHubDocument(key: DocumentKey): HubDocument {
  const [doc, setDoc] = useState<HubDocument>(() => {
    const already = loadedDocument(key);
    return already ? { status: "ready", markdown: already } : { status: "loading" };
  });

  useEffect(() => {
    let cancelled = false;
    loadHubDocuments().then(() => {
      if (cancelled) return;
      const served = loadedDocument(key);
      setDoc(served ? { status: "ready", markdown: served } : { status: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return doc;
}
