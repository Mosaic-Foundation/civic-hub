/**
 * The two dead-end pages: an address with no hub, and a paused hub.
 *
 * Shared by the server (src/middleware/hub.ts, for requests that reach
 * Express) and the UI (ui/src/main.tsx, for the static shell Vercel serves
 * without running the server), so both say exactly the same thing. The
 * runbooks check for the title word for word.
 *
 * Deliberately plain: no hub name, no branding, nothing read from a hub. A
 * request that resolved to no hub has no hub whose identity could
 * legitimately appear on the page.
 */

export interface DeadEnd {
  title: string;
  body: string;
}

/** Keyed by the API's error code (`{ error: "no_hub" }`, `"hub_suspended"`). */
export const DEAD_ENDS = {
  no_hub: {
    title: "No hub here",
    body: "No civic hub is configured at this address. Check the link you followed.",
  },
  hub_suspended: {
    title: "This hub is paused",
    body: "This civic hub is temporarily unavailable. Please check back later.",
  },
} as const satisfies Record<string, DeadEnd>;

export type DeadEndCode = keyof typeof DEAD_ENDS;

export const DEAD_END_STYLE =
  "font: 16px/1.6 system-ui, -apple-system, Segoe UI, sans-serif;" +
  "max-width: 34rem; margin: 18vh auto; padding: 0 1.5rem; color: #1a1a1a;";
