import { useEffect, useState } from "react";
import {
  loadHubDocuments,
  loadedDocument,
  type DocumentKey,
} from "../config/hubDocuments";

/**
 * A hub's version of a document, falling back to the copy bundled with the
 * app until — and if — the hub's own arrives.
 *
 * The fallback is not a loading placeholder, it is the answer for any
 * deployment that has not customised the document, which is most of them. So
 * the page renders immediately with real text and swaps only if the hub
 * actually serves something different.
 */
export function useHubDocument(key: DocumentKey, bundled: string): string {
  const [text, setText] = useState<string>(() => loadedDocument(key) ?? bundled);

  useEffect(() => {
    let cancelled = false;
    loadHubDocuments().then(() => {
      if (cancelled) return;
      const served = loadedDocument(key);
      if (served) setText(served);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return text;
}
