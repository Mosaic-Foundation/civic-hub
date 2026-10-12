// Slice 9 — concrete FetchHtmlFn used by the host hub.
//
// Uses Node's global fetch (Node 20+). Manual redirect following so we
// can cap the chain length per the spec (3) and surface the final URL
// for relative-link resolution in the parser.

import { ValidationError } from "../errors/index.js";
import type { FetchHtmlFn } from "../modules/civic.link_preview/index.js";
import { assertPublicUrl, guardedFetch } from "../utils/ssrfGuard.js";

/** A page's head is all a preview reads; more than this is not a page worth previewing. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export const fetchHtmlForPreview: FetchHtmlFn = async (url, opts) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  let current = url;
  let redirects = 0;
  try {
    // SSRF guard on the initial URL: resolve the host and reject if it points
    // at an internal address. Re-checked on every redirect hop below.
    await assertPublicUrl(current);
    // Manual redirect loop — `redirect: "manual"` lets us surface the
    // hop count and stop early if the server is bouncing us in a loop.
    while (true) {
      // guardedFetch connects to the address it checked (no DNS rebinding
      // between the check above and the connection) and caps the body.
      const res = await guardedFetch(current, {
        method: "GET",
        redirect: "manual",
        maxBytes: MAX_PREVIEW_BYTES,
        signal: controller.signal,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return {
            finalUrl: current,
            status: res.status,
            contentType: res.headers.get("content-type"),
            body: "",
          };
        }
        if (redirects >= opts.maxRedirects) {
          throw new ValidationError("That link redirects too many times.", "too_many_redirects");
        }
        const next = new URL(location, current).toString();
        // Re-validate the redirect target — a public URL can 302 to an
        // internal address; without this the guard on the initial URL is moot.
        await assertPublicUrl(next);
        redirects += 1;
        current = next;
        continue;
      }

      const contentType = res.headers.get("content-type");
      // Read the body even on non-2xx so the caller can decide what to
      // do; our service layer treats anything outside [200, 300) as an
      // error preview.
      const body = await res.text();
      return {
        finalUrl: current,
        status: res.status,
        contentType,
        body,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
};
