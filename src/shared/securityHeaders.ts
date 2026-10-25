// Security headers for the hub app (Audit 2, A8). Pure, and shared by:
//   - vercel.json's `headers` block, which serves the UI's pages and assets
//     (the strings there must equal UI_SECURITY_HEADERS;
//     tests/unit/securityHeaders.test.ts compares them);
//   - the API (src/app.ts), for every JSON response;
//   - `vite preview` locally (ui/vite.config.ts), so Playwright runs the real
//     pages under the same policy.
//
// WHAT THE PAGES LOAD, checked 2026-10-11 before writing the policy:
//   - scripts: only the bundle, from the same origin; no inline script (the
//     HTML shells load one module each), no third-party script, no eval.
//   - styles: the bundle, the inline <style> in index.html and React `style`
//     attributes (theme colours), hence 'unsafe-inline' for styles only.
//   - fonts: none bundled since 2026-10-25 (the system's); font-src stays self.
//   - images: same origin, data: and blob: (the image picker's previews), and
//     https: (uploaded images on Supabase Storage; a link preview's image
//     from whatever site the link names).
//   - connections: the API, at /api on the same origin.
//   - frames: none. Conversations are drawn by the hub's own components (the
//     server talks to the hub's Polis); meeting summaries link to YouTube
//     rather than embedding it. So nothing may frame, and nothing is framed.
// A later page that embeds something adds its origin here, on purpose.

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Every page and asset of the UI. */
export const UI_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Every API response. Mostly JSON, which is never a page; the few pages the
 * server renders itself (the no-hub page in src/middleware/hub.ts, the digest
 * unsubscribe page) use inline styles and one form posting back here. So: no
 * script at all, inline styles, images, and forms to this origin only.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  ...UI_SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
