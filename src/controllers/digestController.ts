// Digest — two HTTP surfaces:
//
//   GET /unsubscribe/digest?token=…
//     No auth. Verifies the HMAC-signed token, flips
//     digest_frequency_days to null, redirects to the settings page.
//
//   PATCH /user/settings/digest
//     Authed (requireAuth). Flips the subscription flag for the
//     currently authenticated user (the settings-page toggle).
//
// The digest email itself is the "digest" job, src/jobs/digest.ts.

import { env } from "../config/env.js";
import { ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { verifyUnsubscribeToken } from "../modules/civic.digest/index.js";
import { setDigestFrequency, getUser } from "../modules/civic.auth/index.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { getAuthUser } from "../middleware/auth.js";
import { hubDisplayNameSync } from "../services/hubSettings.js";

// --- GET /unsubscribe/digest?token=… ---------------------------------------

function renderUnsubscribePage(opts: {
  title: string;
  heading: string;
  body: string;
  error?: boolean;
}): string {
  const color = opts.error ? "#b91c1c" : "#1e3a5f";
  const ui = uiBaseUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; }
    .card { max-width: 480px; margin: 80px auto; background: #ffffff; padding: 32px 28px; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    h1 { font-size: 22px; color: ${color}; margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.5; margin: 0 0 12px; color: #333; }
    a { color: #2c7be5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(opts.heading)}</h1>
    <p>${opts.body}</p>
    <p><a href="${escapeHtml(ui)}">Return to ${escapeHtml(hubDisplayNameSync())}</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// An HTML page for a person clicking a link in an email, so its refusals are
// rendered pages, not JSON; route() still answers anything unforeseen.
export const handleUnsubscribeDigest = route(async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const secret = env.DIGEST_UNSUBSCRIBE_SECRET;

  if (!secret || secret.length < 16) {
    res.status(500).type("html").send(
      renderUnsubscribePage({
        title: "Unsubscribe unavailable",
        heading: "Unsubscribe unavailable",
        body: "This hub isn't configured to process unsubscribe links right now. Please contact the hub operator.",
        error: true,
      }),
    );
    return;
  }

  const userId = verifyUnsubscribeToken(token, secret);
  if (!userId) {
    res.status(400).type("html").send(
      renderUnsubscribePage({
        title: "Invalid unsubscribe link",
        heading: "This link is invalid",
        body:
          "This unsubscribe link is invalid or was signed by a key that's no longer valid. " +
          `Sign in and visit <a href="${escapeHtml(uiBaseUrl())}/settings">Your settings</a> to manage your subscription.`,
        error: true,
      }),
    );
    return;
  }

  try {
    const user = await getUser(userId);
    if (!user) {
      res.status(404).type("html").send(
        renderUnsubscribePage({
          title: "Account not found",
          heading: "Account not found",
          body:
            "We couldn't find an account matching this unsubscribe link. " +
            "The account may have been deleted.",
          error: true,
        }),
      );
      return;
    }

    await setDigestFrequency(userId, null);
    console.log(`[digest] unsubscribed user=${userId}`);

    // Land in Settings, where the frequency control shows "Unsubscribed"
    // selected and can be changed on the spot — not on a bare confirmation
    // page a step away from it (Adam, 2026-09-06: "I don't see where it
    // says unsubscribed"). The query flag lets Settings say what just
    // happened, signed in or not.
    res.redirect(302, `${uiBaseUrl()}/settings?digest=unsubscribed`);
  } catch (err) {
    // Logged for the operator; the page below says nothing of the cause.
    console.error(`[digest] unsubscribe failed for user=${userId}:`, err instanceof Error ? err.message : err);
    res.status(500).type("html").send(
      renderUnsubscribePage({
        title: "Unsubscribe failed",
        heading: "Something went wrong",
        body:
          "We couldn't process your unsubscribe just now. Please try again in a few minutes, or sign in and visit Your settings.",
        error: true,
      }),
    );
  }
});

// --- PATCH /user/settings/digest -------------------------------------------

/**
 * PATCH /user/settings/digest
 *
 * Accepts either the legacy boolean format or the new frequency format:
 *   { subscribed: boolean }              → maps to frequency 1 or null
 *   { digest_frequency_days: number|null } → direct frequency set
 *
 * Returns { digest_frequency_days: number|null }.
 */
export const handlePatchDigestSubscription = route(async (req, res) => {
  const user = getAuthUser(res);
  const body = (req.body ?? {}) as {
    subscribed?: unknown;
    digest_frequency_days?: unknown;
  };

  let frequencyDays: number | null;

  if (body.digest_frequency_days !== undefined) {
    // New format: explicit frequency
    if (body.digest_frequency_days === null) {
      frequencyDays = null;
    } else if (
      typeof body.digest_frequency_days === "number" &&
      Number.isInteger(body.digest_frequency_days) &&
      body.digest_frequency_days >= 1 &&
      body.digest_frequency_days <= 30
    ) {
      frequencyDays = body.digest_frequency_days;
    } else {
      throw new ValidationError("digest_frequency_days must be null (unsubscribe) or an integer 1-30.");
    }
  } else if (typeof body.subscribed === "boolean") {
    // Legacy boolean format for backwards compatibility
    frequencyDays = body.subscribed ? 1 : null;
  } else {
    throw new ValidationError("Body must include { digest_frequency_days: number|null } or { subscribed: boolean }");
  }

  const updated = await setDigestFrequency(user.id, frequencyDays);
  res.json({
    digest_frequency_days: updated.digest_frequency_days,
  });
});
