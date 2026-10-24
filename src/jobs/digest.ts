// The "digest" job (src/jobs/registry.ts): the resident digest email.
//
// Runs hourly, once per active hub, inside that hub's scope
// (src/jobs/runJob.ts). A hub is mailed only in its own send hour
// (plugin.digest.send_hour, read in identity.timezone; 13:00 UTC when neither
// is set, the hour the one deployment-wide digest always went out). Iterates
// that hub's subscribed users, assembles a per-user digest over their "since"
// window, and sends via utils/email (whose guard suppresses non-admins on a
// hub that is not live). Updates last_digest_sent_at only on a successful
// send. Empty digests are skipped silently: no email, no cursor update.
// Returns a JobOutcome: 200 with the counts (or a not-the-send-hour skip),
// 500 with an error and the counts so far if the batch throws or the
// unsubscribe secret is unset. The unsubscribe and settings handlers are in
// digestController.ts.

import { env } from "../config/env.js";
import { currentHubId } from "../config/hubContext.js";
import { getEventsSince } from "../events/eventStore.js";
import { getProcess } from "../services/processService.js";
import { getProcessHandler, processDetailPath } from "../processes/registry.js";
import type { CivicEvent } from "../models/event.js";
import {
  getAllProcesses,
  getHiddenProcessIds,
} from "../services/processService.js";
import {
  buildEditItems,
  assembleDigestForUser,
  buildUnsubscribeUrl,
  type DigestEvent,
  type DigestHubContext,
} from "../modules/civic.digest/index.js";
import {
  listSubscribedUsers,
  markDigestSent,
} from "../modules/civic.auth/index.js";
import { sendEmail } from "../utils/email.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";
import { effectivePostalAddressSync, getSettingSync, hubDisplayNameSync } from "../services/hubSettings.js";
import { KEYS } from "../models/hubSettings.js";
import { hourInZone, resolveTimeZone } from "../utils/hubTime.js";
import type { JobRunner } from "./types.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// Slack subtracted from the next-due calculation so a daily cron firing at a
// fixed wall-clock time isn't off-by-seconds against the prior send's
// completion timestamp (which silently halved the send frequency). Comfortably
// smaller than a day, so it can't cause a double-send within one cron cadence.
const CADENCE_SLACK_MS = 6 * 60 * 60 * 1000; // 6 hours

/** The hub's own address, else the platform's (CIVIC_PLATFORM_POSTAL_ADDRESS); "" leaves it out. */
function postalAddress(): string {
  return effectivePostalAddressSync().value;
}

/** The hour the digest always went out before a hub could choose one. */
export const DEFAULT_DIGEST_SEND_HOUR = 13;

/**
 * The hub in scope's send hour and time zone. An unset or malformed hour is
 * the default; an unset or unknown zone is UTC.
 */
export function digestSchedule(): { hour: number; timeZone: string } {
  const raw = getSettingSync(KEYS.PLUGIN_DIGEST_SEND_HOUR)?.trim() ?? "";
  const n = raw === "" ? NaN : Number(raw);
  const hour = Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_DIGEST_SEND_HOUR;
  return { hour, timeZone: resolveTimeZone(getSettingSync(KEYS.IDENTITY_TIMEZONE)) };
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

/**
 * The events in a user's digest window: those RECORDED after `since`, by
 * `recorded_at` rather than the event's own timestamp, which may be
 * backdated. A vote closed after its deadline is stamped with the deadline
 * (Phase 5 part two, fix 6); judged by that stamp, a close noticed a day late
 * would fall before the cursor and never be mailed.
 */
export function recordedAfter<T extends { recorded_at: string }>(events: readonly T[], since: string): T[] {
  return events.filter((e) => e.recorded_at > since);
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

/**
 * One hub's digest run, inside that hub's scope. The job runner has already
 * checked the cron credential and `plugin.digest.enabled`; this decides
 * whether the hub is due (its send hour, unless `force`) and sends.
 *
 * Idempotent only in the sense that re-running before last_digest_sent_at
 * has been updated will re-send the same events — but the per-user cadence
 * check below stops a second run inside the same day from mailing anyone
 * twice.
 */
export const digestJob: JobRunner = async (input) => {
  const schedule = digestSchedule();
  const localHour = hourInZone(input.now, schedule.timeZone);
  if (!input.force && localHour !== schedule.hour) {
    return {
      status: 200,
      body: {
        skipped: true,
        reason: "not the send hour",
        send_hour: schedule.hour,
        time_zone: schedule.timeZone,
        local_hour: localHour,
      },
    };
  }

  const started = Date.now();
  const secret = env.DIGEST_UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 16) {
    return {
      status: 500,
      body: {
        error:
          "DIGEST_UNSUBSCRIBE_SECRET must be set and >= 16 characters for the digest cron to emit valid unsubscribe links.",
      },
    };
  }

  const apiBase = baseUrl();
  const uiBase = uiBaseUrl();

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  // Held back by the hub's mode (mailGuard.ts): not sent, on purpose. Counted
  // apart from `failed` so a demo or beta hub's digest job does not read
  // "could not be sent to N residents" every day (review #36).
  let heldBack = 0;
  let heldBackReason: string | undefined;

  try {
    const users = await listSubscribedUsers(currentHubId());

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
        hiddenProcessIds = await getHiddenProcessIds();
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
      // An account without a mailbox gets no mail: counted as skipped.
      if (user.email === null) {
        skipped += 1;
        continue;
      }
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
        for (const e of recordedAfter(allRecent, since)) {
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
          hub_name: hubDisplayNameSync(),
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
            events: recordedAfter(allRecent, since)
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

        if (result.held_back) {
          console.log(
            `[digest] user=${user.id} events=${digest.item_count} sent=false held_back=${result.held_back_reason ?? "hub mode"}`,
          );
          heldBack += 1;
          heldBackReason ??= result.held_back_reason;
          continue;
        }

        if (!result.sent) {
          console.warn(
            `[digest] user=${user.id} events=${digest.item_count} sent=false error=${result.error ?? "unknown"}`,
          );
          failed += 1;
          continue;
        }

        await markDigestSent(currentHubId(), user.id, new Date().toISOString());
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

    return {
      status: 200,
      body: {
        processed_users: processed,
        sent_count: sent,
        skipped_count: skipped,
        failed_count: failed,
        held_back_count: heldBack,
        ...(heldBackReason ? { held_back_reason: heldBackReason } : {}),
        duration_ms: Date.now() - started,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[digest] hub=${currentHubId()} batch error: ${message}`);
    return {
      status: 500,
      body: {
        error: message,
        processed_users: processed,
        sent_count: sent,
        skipped_count: skipped,
        failed_count: failed,
        held_back_count: heldBack,
        ...(heldBackReason ? { held_back_reason: heldBackReason } : {}),
        duration_ms: Date.now() - started,
      },
    };
  }
};
