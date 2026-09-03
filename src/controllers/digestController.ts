// Digest controllers — three HTTP surfaces:
//
//   POST /internal/digest/run
//     Cron-triggered. Iterates every subscribed user, assembles a
//     per-user digest over their "since" window, sends via Resend
//     (utils/email). Updates last_digest_sent_at only on a successful
//     send. Empty digests are skipped silently — no email, no cursor
//     update.
//
//   GET /unsubscribe/digest?token=…
//     No auth. Verifies the HMAC-signed token, flips
//     digest_frequency_days to null, returns a simple HTML confirmation.
//
//   PATCH /user/settings/digest
//     Authed (requireAuth). Flips the subscription flag for the
//     currently authenticated user (the settings-page toggle).
//
// Slice 5.

import { Request, Response } from "express";
import { getEventsSince } from "../events/eventStore.js";
import { getProcess } from "../services/processService.js";
import { getProcessHandler, processDetailPath } from "../processes/registry.js";
import type { CivicEvent } from "../models/event.js";
import {
  getAllProcesses,
  getNonPublicProcessIds,
} from "../services/processService.js";
import {
  buildEditItems,
  assembleDigestForUser,
  buildUnsubscribeUrl,
  verifyUnsubscribeToken,
  type DigestEvent,
  type DigestHubContext,
} from "../modules/civic.digest/index.js";
import {
  listSubscribedUsers,
  markDigestSent,
  setDigestFrequency,
  getUser,
} from "../modules/civic.auth/index.js";
import { sendEmail } from "../utils/email.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";
import { getAuthUser } from "../middleware/auth.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Slack subtracted from the next-due calculation so a daily cron firing at a
// fixed wall-clock time isn't off-by-seconds against the prior send's
// completion timestamp (which silently halved the send frequency). Comfortably
// smaller than a day, so it can't cause a double-send within one cron cadence.
const CADENCE_SLACK_MS = 6 * 60 * 60 * 1000; // 6 hours
const HUB_NAME_FALLBACK = "Floyd Civic Hub";

function hubName(): string {
  return process.env.HUB_NAME?.trim() || HUB_NAME_FALLBACK;
}

function postalAddress(): string {
  return (
    process.env.HUB_POSTAL_ADDRESS?.trim() ||
    "Floyd, VA"
  );
}

function digestEnabled(): boolean {
  // Default to true. Only "false" (case-insensitive) disables.
  const v = process.env.DIGEST_ENABLED?.trim().toLowerCase();
  return v !== "false";
}

function requireCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  // Constant-time compare is overkill for this shared secret; standard
  // compare is acceptable for a cron-gate credential that isn't
  // user-chosen and can't be probed for partial matches in this code path.
  return token.length > 0 && token === secret;
}

function clampSince(user: {
  created_at: string;
  last_digest_sent_at: string | null;
}): string {
  const now = Date.now();
  const floor = new Date(now - THIRTY_DAYS_MS).toISOString();
  const anchor = user.last_digest_sent_at ?? user.created_at;
  return anchor < floor ? floor : anchor;
}

function toDigestEvent(e: CivicEvent, targetBase: string): DigestEvent {
  return {
    id: e.id,
    event_type: e.event_type,
    timestamp: e.timestamp,
    process_id: e.process_id,
    action_url: rewriteLocalhostOrigin(e.action_url, targetBase),
    data: e.data,
  };
}

/**
 * Rewrite a stored event's action_url to the current hub origin when the
 * stored origin is a localhost sentinel. Events are append-only (a DB
 * trigger blocks UPDATE/DELETE), so an event emitted on a deploy that
 * didn't have BASE_URL set would permanently carry localhost:3000 in its
 * action_url. Links inside emails must be absolute, so we correct the
 * origin at render time. Path + query are preserved.
 *
 * The Feed's FeedPost.classifyHref already does the equivalent trick —
 * it routes by pathname and ignores the origin. Email clients don't have
 * that luxury, so we do it here.
 */
function rewriteLocalhostOrigin(rawUrl: string, targetBase: string): string {
  if (!rawUrl) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return rawUrl;
    }
    const target = new URL(targetBase);
    parsed.protocol = target.protocol;
    parsed.hostname = target.hostname;
    parsed.port = target.port;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

// --- POST /internal/digest/run ---------------------------------------------

/**
 * Cron endpoint. Protected by CRON_SECRET bearer auth (Vercel Cron auto-
 * injects this header). Idempotent only in the sense that re-running
 * before last_digest_sent_at has been updated will re-send the same
 * events — but under normal operation a day passes between runs, so the
 * window shifts.
 */
export async function handleRunDigest(
  req: Request,
  res: Response,
): Promise<void> {
  if (!requireCronSecret(req)) {
    res.status(401).json({ error: "Invalid or missing cron credential" });
    return;
  }

  if (!digestEnabled()) {
    res.status(200).json({ skipped: true, reason: "digest disabled" });
    return;
  }

  const started = Date.now();
  const secret = process.env.DIGEST_UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 16) {
    res.status(500).json({
      error:
        "DIGEST_UNSUBSCRIBE_SECRET must be set and >= 16 characters for the digest cron to emit valid unsubscribe links.",
    });
    return;
  }

  const apiBase = baseUrl();
  const uiBase = uiBaseUrl();

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const users = await listSubscribedUsers();

    // Pull the earliest cursor across the whole subscribed set so we
    // query the event store once, then filter in-memory per user. This
    // keeps the cron's DB fan-out bounded as the user count grows.
    const earliest = users.reduce<string>((acc, u) => {
      const since = clampSince(u);
      return since < acc ? since : acc;
    }, new Date().toISOString());

    const allRecentRaw =
      users.length === 0 ? [] : await getEventsSince(earliest);
    // Slice 11 — moderation events are restricted-visibility and must
    // never reach a resident's inbox via the digest. Filter them at
    // the cron entry point so every per-user pass below operates on
    // public events only.
    const allRecent = allRecentRaw.filter(
      (e) => e.meta?.visibility !== "restricted",
    );

    // One-shot lookup of process_id → title. civic.vote and civic.brief
    // events don't carry the title inline; the module uses this as a
    // fallback when its own payload doesn't have one. We fetch every
    // process once per cron run (cheap for MVP scale) instead of per
    // user or per event.
    //
    // Slice 9: same loop also builds process_id → image_url so the
    // digest can render small thumbnails next to titles. We pull the
    // image from `state.content.image_url` (the canonical Slice-9
    // location for both civic.announcement and civic.vote_results).
    const processTitles: Record<string, string> = {};
    const processThumbnails: Record<string, string> = {};
    // Slice 11 — track removed announcements so we can drop their
    // events from the digest window even if the original publish event
    // is still inside the user's "since" cursor. The feed and the
    // public list endpoint already exclude these; the digest must too.
    const removedAnnouncementIds = new Set<string>();
    // Archived / pending-review processes: their events must not reach the
    // digest either (matches the feed status-filter). getAllProcesses() below
    // already omits these, so this is the only place their ids are known.
    let hiddenProcessIds = new Set<string>();
    if (users.length > 0) {
      try {
        hiddenProcessIds = await getNonPublicProcessIds();
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        console.warn(`[digest] non-public process lookup failed: ${message}`);
      }
      try {
        const allProcesses = await getAllProcesses();
        for (const p of allProcesses) {
          processTitles[p.id] = p.title;
          if (p.definition.type === "civic.announcement") {
            const moderation = (p.state as { moderation?: { removed?: unknown } } | null | undefined)
              ?.moderation;
            if (moderation && (moderation as { removed?: unknown }).removed) {
              removedAnnouncementIds.add(p.id);
            }
          }
          const content = (p.state as { content?: { image_url?: unknown } } | null | undefined)?.content;
          const imageUrl = content?.image_url;
          if (typeof imageUrl === "string" && imageUrl.length > 0) {
            processThumbnails[p.id] = imageUrl;
          }
        }
      } catch (err) {
        // Non-fatal: fall back to generic labels in the digest. The
        // batch continues.
        const message = err instanceof Error ? err.message : "unknown error";
        console.warn(`[digest] title lookup failed: ${message}`);
      }
    }

    // Edited processes in the window → who supports them (the type's own
    // listSupporters, resolved once per run), for the personal "a project
    // you support was edited" digest line. Only types that opt into edits
    // ever produce these events, so this is empty on most runs.
    const editSupporters: Record<string, Set<string>> = {};
    const editProcesses: Record<string, { title: string; href: string }> = {};
    {
      const editedIds = new Set<string>();
      for (const e of allRecent) {
        const edit = (e.data as { edit?: { changed_fields?: unknown } } | null)?.edit;
        if (e.process_id && edit && Array.isArray(edit.changed_fields) && edit.changed_fields.length) {
          editedIds.add(e.process_id);
        }
      }
      for (const id of editedIds) {
        if (hiddenProcessIds.has(id)) continue;
        try {
          const proc = await getProcess(id);
          const handler = proc ? getProcessHandler(proc.definition.type) : undefined;
          if (!proc || !handler?.listSupporters) continue;
          editSupporters[id] = new Set(await handler.listSupporters(id));
          editProcesses[id] = {
            title: proc.title,
            href: `${uiBase}${processDetailPath(proc.definition.type, id)}`,
          };
        } catch (err) {
          console.warn(`[digest] supporter lookup failed for ${id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const now = Date.now();

    for (const user of users) {
      processed += 1;
      try {
        // Frequency-aware skip: if the user has a frequency > 1 day and
        // their last digest was sent less than frequency_days ago, skip.
        // Subtract a slack window so a daily cron that fires at the same
        // wall-clock time each day isn't judged "a few seconds early" against
        // the previous send's *completion* timestamp — that off-by-seconds
        // silently turned a daily digest into an every-other-day one.
        const freqDays = user.digest_frequency_days ?? 1;
        if (user.last_digest_sent_at) {
          const lastSent = new Date(user.last_digest_sent_at).getTime();
          const nextDue =
            lastSent + freqDays * 24 * 60 * 60 * 1000 - CADENCE_SLACK_MS;
          if (now < nextDue) {
            skipped += 1;
            continue;
          }
        }

        const since = clampSince(user);
        const windowEvents: DigestEvent[] = [];
        for (const e of allRecent) {
          if (e.timestamp <= since) continue;
          // Drop events for announcements an admin has removed since
          // they were published. The user shouldn't see the removed
          // announcement reappear in their email even if the publish
          // event still falls inside their digest window.
          if (e.process_id && removedAnnouncementIds.has(e.process_id)) continue;
          // Drop events for archived / pending-review processes.
          if (e.process_id && hiddenProcessIds.has(e.process_id)) continue;
          windowEvents.push(toDigestEvent(e, uiBase));
        }

        const hub: DigestHubContext = {
          hub_name: hubName(),
          ui_base_url: uiBase,
          postal_address: postalAddress(),
          unsubscribe_url: buildUnsubscribeUrl({
            userId: user.id,
            apiBaseUrl: apiBase,
            secret,
          }),
          manage_subscriptions_url: `${uiBase}/settings`,
        };

        const digest = assembleDigestForUser({
          user: {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
            last_digest_sent_at: user.last_digest_sent_at,
          },
          events: windowEvents,
          hub,
          since,
          personal_items: buildEditItems({
            user_id: user.id,
            events: allRecent
              .filter((e) => e.timestamp > since)
              .map((e) => ({ ...toDigestEvent(e, uiBase), actor: e.actor })),
            supporters: editSupporters,
            processes: editProcesses,
          }),
          process_titles: processTitles,
          process_thumbnails: processThumbnails,
        });

        if (!digest) {
          console.log(
            `[digest] user=${user.id} events=0 sent=false reason=empty`,
          );
          skipped += 1;
          continue;
        }

        const result = await sendEmail({
          to: digest.to,
          subject: digest.subject,
          html: digest.html,
          text: digest.text,
        });

        if (!result.sent) {
          console.warn(
            `[digest] user=${user.id} events=${digest.item_count} sent=false error=${result.error ?? "unknown"}`,
          );
          failed += 1;
          continue;
        }

        await markDigestSent(user.id, new Date().toISOString());
        console.log(
          `[digest] user=${user.id} events=${digest.item_count} sent=true resend_id=${result.id ?? "?"}`,
        );
        sent += 1;
      } catch (err) {
        // One user's failure must not abort the batch.
        const message = err instanceof Error ? err.message : "unknown error";
        console.warn(`[digest] user=${user.id} sent=false error=${message}`);
        failed += 1;
      }
    }

    res.status(200).json({
      processed_users: processed,
      sent_count: sent,
      skipped_count: skipped,
      failed_count: failed,
      duration_ms: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[digest] batch error: ${message}`);
    res.status(500).json({
      error: message,
      processed_users: processed,
      sent_count: sent,
      skipped_count: skipped,
      failed_count: failed,
      duration_ms: Date.now() - started,
    });
  }
}

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
    <p><a href="${escapeHtml(ui)}">Return to ${escapeHtml(hubName())}</a></p>
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

export async function handleUnsubscribeDigest(
  req: Request,
  res: Response,
): Promise<void> {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const secret = process.env.DIGEST_UNSUBSCRIBE_SECRET;

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
          `Sign in and visit <a href="${escapeHtml(uiBaseUrl())}/settings">Settings</a> to manage your subscription.`,
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

    res.status(200).type("html").send(
      renderUnsubscribePage({
        title: "Unsubscribed",
        heading: "You've been unsubscribed",
        body:
          `You will no longer receive the email digest from ${escapeHtml(hubName())}. ` +
          `You can re-subscribe or change your digest frequency any time from the <a href="${escapeHtml(uiBaseUrl())}/settings">Settings</a> page.`,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[digest] unsubscribe failed for user=${userId}: ${message}`);
    res.status(500).type("html").send(
      renderUnsubscribePage({
        title: "Unsubscribe failed",
        heading: "Something went wrong",
        body:
          "We couldn't process your unsubscribe just now. Please try again in a few minutes, or sign in and visit Settings.",
        error: true,
      }),
    );
  }
}

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
export async function handlePatchDigestSubscription(
  req: Request,
  res: Response,
): Promise<void> {
  try {
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
        res.status(400).json({
          error:
            "digest_frequency_days must be null (unsubscribe) or an integer 1-30.",
        });
        return;
      }
    } else if (typeof body.subscribed === "boolean") {
      // Legacy boolean format for backwards compatibility
      frequencyDays = body.subscribed ? 1 : null;
    } else {
      res.status(400).json({
        error:
          "Body must include { digest_frequency_days: number|null } or { subscribed: boolean }",
      });
      return;
    }

    const updated = await setDigestFrequency(user.id, frequencyDays);
    res.json({
      digest_frequency_days: updated.digest_frequency_days,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
