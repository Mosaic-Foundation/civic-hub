// civic.digest/service.ts — pure assembly + formatting.
//
// Stateless: no DB, no env, no network. The caller passes the user, the
// list of already-filtered events, and hub context. The service returns
// a fully-formed DigestEmail ready to hand to the mailer, or null when
// the user has no new activity to report.
//
// Phase 3 — feed-worthiness, kind, pill label, and link all come from the
// single shared classifier (src/shared/feedActivity.ts), the same one the web
// feed uses. The digest groups the classifier's kinds into email sections and
// renders each with a pill color that mirrors the feed's per-kind palette
// (inlined as hex literals — email clients don't read CSS variables).

import {
  classifyActivity,
  type Activity,
  type ActivityKind,
  type ClassifierEvent,
} from "../../shared/feedActivity.js";
import { sortDigestItems } from "./filter.js";
import type {
  DigestAssemblyInput,
  DigestEmail,
  DigestEvent,
  DigestHubContext,
  DigestItem,
} from "./models.js";

// --- Assembly ---------------------------------------------------------------

/**
 * Turn a user + a list of events into a ready-to-send digest email.
 * Returns null when nothing survives filtering — the caller skips the
 * send and does NOT advance `last_digest_sent_at`.
 */
export function assembleDigestForUser(
  input: DigestAssemblyInput,
): DigestEmail | null {
  const titles = input.process_titles ?? {};
  const thumbnails = input.process_thumbnails ?? {};
  const items: DigestItem[] = [];
  for (const event of input.events) {
    const activity = classifyActivity(event as ClassifierEvent);
    if (!activity) continue;
    items.push(
      eventToItem(event, activity, titles, thumbnails, input.hub.ui_base_url),
    );
  }

  if (items.length === 0) return null;

  const sorted = sortDigestItems(items);
  const subject = buildSubject(input.hub, sorted.length, new Date());
  const html = formatDigestHtml(sorted, input.hub, subject);
  const text = formatDigestText(sorted, input.hub, subject);

  return {
    user_id: input.user.id,
    to: input.user.email,
    subject,
    html,
    text,
    item_count: sorted.length,
  };
}

/**
 * Absolutize a classifier href for email. The classifier returns either an
 * absolute URL (the event's own action_url, possibly an external link) or a
 * relative SPA path (wordcloud/proposal/conversation pages). Email links must
 * be absolute, so prefix relative paths with the hub UI base.
 */
function absolutize(href: string, uiBase: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${uiBase.replace(/\/$/, "")}${href}`;
}

function eventToItem(
  event: DigestEvent,
  activity: Activity,
  titles: Record<string, string>,
  thumbnails: Record<string, string>,
  uiBase: string,
): DigestItem {
  const { title, summary } = digestTitleSummary(activity, event, titles);
  return {
    kind: activity.kind,
    title,
    // Pill label is the classifier's — identical to the feed card pill.
    pill_label: activity.pill,
    summary,
    action_url: absolutize(activity.href, uiBase),
    timestamp: event.timestamp,
    thumbnail_url: event.process_id
      ? thumbnails[event.process_id] ?? null
      : null,
  };
}

/**
 * Derive the title + 1-line summary for a digest row from its classified kind
 * and the event payload (falling back to the caller-supplied process_titles
 * map). Mirrors the feed's per-kind copy, kept digest-flavored (the email has
 * no fetched description, so summaries are short canned strings or payload
 * data). Pure presentation — feed-worthiness already happened upstream.
 */
function digestTitleSummary(
  activity: Activity,
  event: DigestEvent,
  titles: Record<string, string>,
): { title: string; summary: string } {
  const d = event.data as {
    process?: { title?: unknown };
    announcement?: { title?: unknown; body_preview?: unknown };
    proposal?: { title?: unknown };
    project?: { title?: unknown };
    headline_result?: unknown;
    participation_count?: unknown;
    meeting_summary?: { meeting_title?: unknown; meeting_date?: unknown; block_count?: unknown };
    meeting_title?: unknown;
    meeting_date?: unknown;
    block_count?: unknown;
  };

  const fromPayload =
    (typeof d?.announcement?.title === "string" && d.announcement.title) ||
    (typeof d?.proposal?.title === "string" && d.proposal.title) ||
    (typeof d?.project?.title === "string" && d.project.title) ||
    (typeof d?.process?.title === "string" && d.process.title) ||
    null;
  const fromMap = event.process_id ? titles[event.process_id] : null;
  const rawTitle = fromPayload || fromMap || null;

  switch (activity.kind) {
    case "vote-open":
      return { title: rawTitle ?? "New vote open", summary: "New vote now open — cast your ballot." };

    case "vote-results": {
      const count =
        typeof d?.participation_count === "number" ? d.participation_count : 0;
      const noun = count === 1 ? "resident" : "residents";
      const headline =
        typeof d?.headline_result === "string" ? d.headline_result : "";
      return {
        title: rawTitle ?? "Vote results",
        summary: headline
          ? `${count} ${noun} voted — ${headline}`
          : `${count} ${noun} voted — delivered to the Board.`,
      };
    }

    case "meeting": {
      const meetingDate =
        (typeof d?.meeting_summary?.meeting_date === "string" && d.meeting_summary.meeting_date) ||
        (typeof d?.meeting_date === "string" && d.meeting_date) ||
        "";
      const meetingTitle =
        (typeof d?.meeting_summary?.meeting_title === "string" && d.meeting_summary.meeting_title) ||
        (typeof d?.meeting_title === "string" && d.meeting_title) ||
        rawTitle ||
        "Board meeting";
      const blockCount =
        typeof d?.meeting_summary?.block_count === "number"
          ? d.meeting_summary.block_count
          : typeof d?.block_count === "number"
            ? d.block_count
            : 0;
      const topicsNoun = blockCount === 1 ? "topic" : "topics";
      return {
        title: meetingTitle,
        summary: `${formatMeetingDate(meetingDate)} · ${blockCount} ${topicsNoun} covered.`,
      };
    }

    case "announcement":
    case "announcement-author": {
      const preview =
        typeof d?.announcement?.body_preview === "string"
          ? d.announcement.body_preview
          : "";
      return { title: rawTitle ?? "New announcement", summary: truncate(preview, 160) };
    }

    case "wordcloud":
      return { title: rawTitle ?? "Word cloud", summary: "New word cloud open — share your response." };

    case "proposal":
      return { title: rawTitle ?? "New proposal", summary: "A new idea is open for support and discussion." };

    case "proposal-closed":
      return { title: rawTitle ?? "Proposal", summary: "The discussion period has ended." };

    case "project-created":
      return { title: rawTitle ?? "New project", summary: "A new community project was posted." };

    case "project-updated":
      return { title: rawTitle ?? "Project update", summary: "A community project has a new update." };

    case "conversation":
      return { title: rawTitle ?? "New conversation", summary: "Join the conversation and share your view." };

    case "conversation-results":
      return { title: rawTitle ?? "Conversation results", summary: "The conversation has concluded — see the results." };

    case "brief": {
      const brief = (event.data as { brief?: { title?: unknown; headline?: unknown } })
        ?.brief;
      const title =
        (typeof brief?.title === "string" && brief.title) || rawTitle || "Civic Brief";
      const summary =
        (typeof brief?.headline === "string" && brief.headline) ||
        "A process has concluded — see the brief.";
      return { title, summary };
    }

    case "brief-response": {
      const data = event.data as {
        brief?: { title?: unknown };
        response?: { excerpt?: unknown; official_title?: unknown };
      };
      const title =
        (typeof data?.brief?.title === "string" && data.brief.title) ||
        rawTitle ||
        "Civic Brief";
      const office =
        typeof data?.response?.official_title === "string"
          ? data.response.official_title
          : "";
      const summary =
        (typeof data?.response?.excerpt === "string" &&
          data.response.excerpt) ||
        (office
          ? `The ${office} has responded — read the response.`
          : "An official has responded — read the response.");
      return { title, summary };
    }
  }
}

// --- Subject ----------------------------------------------------------------

function buildSubject(
  hub: DigestHubContext,
  itemCount: number,
  now: Date,
): string {
  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const noun = itemCount === 1 ? "new item" : "new items";
  return `${hub.hub_name} — ${dateLabel} update (${itemCount} ${noun})`;
}

// --- Sections ---------------------------------------------------------------

type DigestSection =
  | "votes_open"
  | "vote_results"
  | "meeting_summaries"
  | "announcements"
  | "word_clouds"
  | "proposals"
  | "projects"
  | "conversations"
  | "briefs";

/** Which email section each classifier kind renders under. */
const SECTION_OF: Record<ActivityKind, DigestSection> = {
  "vote-open": "votes_open",
  "vote-results": "vote_results",
  meeting: "meeting_summaries",
  announcement: "announcements",
  "announcement-author": "announcements",
  wordcloud: "word_clouds",
  proposal: "proposals",
  "proposal-closed": "proposals",
  "project-created": "projects",
  "project-updated": "projects",
  conversation: "conversations",
  "conversation-results": "conversations",
  brief: "briefs",
  // A response belongs with the outcome it answers, not in its own
  // section — the "Completed — results" section carries both the brief
  // and, later, the government's reply to it.
  "brief-response": "briefs",
};

const SECTION_LABELS: Record<DigestSection, string> = {
  votes_open: "New votes open",
  vote_results: "New vote results",
  meeting_summaries: "New meeting summaries",
  announcements: "Announcements",
  word_clouds: "Word clouds",
  proposals: "Proposals",
  projects: "Projects",
  conversations: "Conversations",
  briefs: "Completed — results",
};

const SECTION_ORDER: DigestSection[] = [
  "votes_open",
  "vote_results",
  "meeting_summaries",
  "announcements",
  "word_clouds",
  "proposals",
  "projects",
  "conversations",
  "briefs",
];

// --- HTML formatting --------------------------------------------------------

/**
 * Per-kind pill background/foreground hex pairs. Mirror the
 * --pill-<kind>-* tokens (and the Phase-3 additions) in the UI's
 * theme.css / Feed.css. Inlined as literals because email clients don't
 * honor CSS vars.
 */
const PILL_COLORS: Record<ActivityKind, { bg: string; fg: string }> = {
  "vote-open": { bg: "#e0ecfc", fg: "#1e3a5f" },
  "vote-results": { bg: "#d4ede8", fg: "#0f5a55" },
  meeting: { bg: "#d9ecd9", fg: "#0f4a26" },
  announcement: { bg: "#fbe5d3", fg: "#8c3210" },
  "announcement-author": { bg: "#e4ddf0", fg: "#3a2c5e" },
  wordcloud: { bg: "#e0f2f1", fg: "#00695c" },
  proposal: { bg: "#ede7f6", fg: "#5e35b1" },
  "proposal-closed": { bg: "#ece9f1", fg: "#5b517a" },
  "project-created": { bg: "#e3f2fd", fg: "#1565c0" },
  "project-updated": { bg: "#e3f2fd", fg: "#1565c0" },
  conversation: { bg: "#e8eaf6", fg: "#3949ab" },
  "conversation-results": { bg: "#e6e9f3", fg: "#3f4a86" },
  brief: { bg: "#dce5f2", fg: "#1f3a66" },
  "brief-response": { bg: "#fdf1e0", fg: "#8a5a13" },
};

// Both stacks fall back through the OS sans family so email clients
// without Inter/Manrope (Outlook on Windows, older webmail) still get a
// clean modern sans rather than reverting to a serif default.
const FONT_BODY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_HEADING =
  "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function formatDigestHtml(
  items: DigestItem[],
  hub: DigestHubContext,
  subject: string,
): string {
  const grouped = groupBySection(items);
  const sections: string[] = [];
  for (const section of SECTION_ORDER) {
    const group = grouped.get(section);
    if (!group || group.length === 0) continue;
    sections.push(renderSectionHtml(SECTION_LABELS[section], group));
  }

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#fafaf7;font-family:${FONT_BODY};color:#1a1a1a;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <h1 style="font-family:${FONT_HEADING};font-size:24px;font-weight:600;margin:0 0 8px;color:#1e3a5f;letter-spacing:-0.005em;">${escapeHtml(hub.hub_name)}</h1>
    <p style="font-size:13px;color:#8a8a8a;margin:0 0 24px;">${escapeHtml(subject)}</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">Hello from ${escapeHtml(hub.hub_name)},</p>
    <p style="font-size:15px;line-height:1.5;margin:0 0 24px;">Here's what's new since your last update.</p>
    ${sections.join("\n")}
    <hr style="border:none;border-top:1px solid #e5e5e0;margin:32px 0 16px;" />
    <p style="font-size:12px;color:#8a8a8a;line-height:1.6;margin:0;">
      <a href="${escapeAttr(hub.manage_subscriptions_url)}" style="color:#2c7be5;">Change digest frequency</a>
      &nbsp;·&nbsp;
      <a href="${escapeAttr(hub.unsubscribe_url)}" style="color:#2c7be5;">Unsubscribe</a>
    </p>
    <p style="font-size:12px;color:#8a8a8a;margin:12px 0 0;">${escapeHtml(hub.postal_address)}</p>
  </div>
</body>
</html>`;
}

function renderSectionHtml(label: string, items: DigestItem[]): string {
  // Each row is a <table> wrapped in a single <a display:block> so the
  // entire row — title, summary, pill, and the whitespace between — is
  // one click target. The pill color is per-row (item.kind) so a section
  // with mixed kinds (e.g. admin + board announcements) colors each
  // correctly.
  const rows = items
    .map((item) => {
      const { bg, fg } = PILL_COLORS[item.kind];
      const thumbCell = item.thumbnail_url
        ? `
              <td valign="top" width="60" style="padding:0 12px 0 0;">
                <img src="${escapeAttr(item.thumbnail_url)}" alt="" width="60" height="60" style="display:block;width:60px;height:60px;border-radius:8px;object-fit:cover;border:0;" />
              </td>`
        : "";
      const summaryBlock = item.summary
        ? `<div style="font-family:${FONT_BODY};font-size:14px;color:#595959;line-height:1.5;margin:6px 0 0;">${escapeHtml(item.summary)}</div>`
        : "";
      return `
        <li style="margin:0 0 18px;padding:0;list-style:none;">
          <a href="${escapeAttr(item.action_url)}" style="display:block;text-decoration:none;color:inherit;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
              <tr>
                ${thumbCell}
                <td valign="top" style="padding:0 12px 0 0;">
                  <span style="display:inline-block;background:${bg};color:${fg};font-family:${FONT_BODY};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:3px 10px;border-radius:9999px;margin:0 0 8px;">${escapeHtml(item.pill_label)}</span>
                  <div style="font-family:${FONT_HEADING};color:#1a1a1a;font-weight:600;font-size:18px;line-height:1.25;">${escapeHtml(item.title)}</div>
                  ${summaryBlock}
                </td>
                <td valign="top" align="right" width="16" style="white-space:nowrap;font-family:${FONT_BODY};font-size:18px;line-height:1.25;color:#9ca3af;">&rsaquo;</td>
              </tr>
            </table>
          </a>
        </li>
      `;
    })
    .join("");

  return `
    <section style="margin:0 0 28px;">
      <h2 style="font-family:${FONT_BODY};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#595959;margin:0 0 14px;">${escapeHtml(label)}</h2>
      <ul style="margin:0;padding:0;">${rows}</ul>
    </section>
  `;
}

// --- Plain-text formatting --------------------------------------------------

export function formatDigestText(
  items: DigestItem[],
  hub: DigestHubContext,
  subject: string,
): string {
  const grouped = groupBySection(items);
  const sections: string[] = [];
  for (const section of SECTION_ORDER) {
    const group = grouped.get(section);
    if (!group || group.length === 0) continue;
    const label = SECTION_LABELS[section].toUpperCase();
    const rows = group
      .map((item) => {
        // Plain-text counterpart: pill label trails the title in
        // brackets so the type signal still travels.
        const body = item.summary ? `\n  ${item.summary}` : "";
        return `• ${item.title} [${item.pill_label}]${body}\n  ${item.action_url}`;
      })
      .join("\n\n");
    sections.push(`${label}\n${"-".repeat(label.length)}\n${rows}`);
  }

  return [
    hub.hub_name,
    subject,
    "",
    `Hello from ${hub.hub_name},`,
    "",
    "Here's what's new since your last update.",
    "",
    sections.join("\n\n"),
    "",
    "---",
    `Change digest frequency: ${hub.manage_subscriptions_url}`,
    `Unsubscribe: ${hub.unsubscribe_url}`,
    hub.postal_address,
  ].join("\n");
}

// --- Helpers ----------------------------------------------------------------

function groupBySection(items: DigestItem[]): Map<DigestSection, DigestItem[]> {
  const out = new Map<DigestSection, DigestItem[]>();
  for (const item of items) {
    const section = SECTION_OF[item.kind];
    const list = out.get(section) ?? [];
    list.push(item);
    out.set(section, list);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Format a YYYY-MM-DD meeting date for digest subjects/items. Falls back
 * to the raw string if parsing fails.
 */
function formatMeetingDate(iso: string): string {
  if (!iso) return "(date unknown)";
  const d = iso.includes("T")
    ? new Date(iso)
    : new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
