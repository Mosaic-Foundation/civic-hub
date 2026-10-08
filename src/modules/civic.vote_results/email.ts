// civic.vote_results module — email formatting
//
// Pure functions that turn a VoteResultsProcessState into an email
// subject + body pair. Delivery is the host hub's responsibility (see
// SendEmailFn in models.ts).

import type { VoteResultsContent, VoteResultsProcessState } from "./models.js";
import { hubKindOf, participantNoun } from "../../shared/hubKind.js";
import { getSettingSync } from "../../services/hubSettings.js";
import { KEYS } from "../../models/hubSettings.js";

// What the people taking part are called on this hub (review R29, 2026-10-07).
const hubNoun = (n: number): string =>
  participantNoun(hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)), n, getSettingSync(KEYS.COPY_RESIDENT_NOUN));

export interface VoteResultsEmail {
  subject: string;
  html: string;
  text: string;
}

export function formatVoteResultsEmail(
  state: VoteResultsProcessState,
  options: {
    hubLabel: string;           // e.g. "Floyd Civic Hub"
    publicUrl: string;          // e.g. "https://example.org/vote-results/abc123"
  },
): VoteResultsEmail {
  const subject = `${options.hubLabel} — Vote results: ${state.content.title}`;
  return {
    subject,
    text: renderText(state, options),
    html: renderHtml(state, options),
  };
}

function renderText(
  state: VoteResultsProcessState,
  options: { hubLabel: string; publicUrl: string },
): string {
  const c = state.content;
  const lines: string[] = [];
  lines.push(c.title);
  lines.push("=".repeat(c.title.length));
  lines.push("");
  lines.push("Vote results");
  lines.push("");

  // Snapshot of the original vote question, when available. Lets the
  // recipient (Board of Supervisors) see what residents were asked
  // without bouncing back to the vote process page.
  if (c.vote_context?.description) {
    lines.push("About this vote:");
    lines.push(c.vote_context.description);
    lines.push("");
    if (c.vote_context.options.length > 0) {
      lines.push("Options on the ballot:");
      for (const o of c.vote_context.options) lines.push(`  • ${o.option_label}`);
      lines.push("");
    }
  }

  lines.push(
    `Participation: ${c.participation_count} ${hubNoun(c.participation_count)}`,
  );
  lines.push("");
  lines.push("Positions:");
  for (const p of c.position_breakdown) {
    lines.push(`  • ${p.option_label}: ${p.count} (${p.percentage}%)`);
  }
  if (c.comments.length > 0) {
    lines.push("");
    lines.push("Community comments:");
    for (const comment of c.comments) lines.push(`  • ${comment}`);
  }
  if (c.admin_notes.trim().length > 0) {
    lines.push("");
    lines.push("Notes from the Civic Hub:");
    lines.push(c.admin_notes.trim());
  }
  lines.push("");
  lines.push(`View online: ${options.publicUrl}`);
  lines.push("");
  lines.push(`— ${options.hubLabel}`);
  return lines.join("\n");
}

function renderHtml(
  state: VoteResultsProcessState,
  options: { hubLabel: string; publicUrl: string },
): string {
  const c = state.content;
  const positions = c.position_breakdown
    .map(
      (p) =>
        `<li><strong>${escape(p.option_label)}:</strong> ${p.count} (${p.percentage}%)</li>`,
    )
    .join("");
  const comments = c.comments.length
    ? `<h3>Community comments</h3><ul>${c.comments.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>`
    : "";
  const adminNotes = c.admin_notes.trim().length
    ? `<h3>Notes from the Civic Hub</h3><p>${escape(c.admin_notes.trim()).replace(/\n/g, "<br/>")}</p>`
    : "";
  const participants = `${c.participation_count} ${hubNoun(c.participation_count)}`;
  const aboutVote = c.vote_context?.description
    ? `
      <h3>About this vote</h3>
      <p style="color:#555;">${escape(c.vote_context.description).replace(/\n/g, "<br/>")}</p>
      ${
        c.vote_context.options.length > 0
          ? `<p style="margin:8px 0 0;"><strong>Options on the ballot:</strong></p>
             <ul>${c.vote_context.options
               .map((o) => `<li>${escape(o.option_label)}</li>`)
               .join("")}</ul>`
          : ""
      }`
    : "";
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1a1a1a; max-width:640px; margin:0 auto; padding:24px;">
  <h1 style="font-size:22px; margin:0 0 8px;">${escape(c.title)}</h1>
  <p style="color:#555; margin:0 0 16px;">Vote results — ${options.hubLabel}</p>
  ${aboutVote}
  <p><strong>Participation:</strong> ${participants}</p>
  <h3>Positions</h3>
  <ul>${positions}</ul>
  ${comments}
  ${adminNotes}
  <hr style="border:none; border-top:1px solid #e5e5e5; margin:24px 0;"/>
  <p><a href="${escape(options.publicUrl)}">View these results online</a></p>
  <p style="color:#888; font-size:12px;">— ${options.hubLabel}</p>
</body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Human-readable one-liner for a vote-results content block, useful for
 * logs and the feed post summary.
 */
export function headlineFor(content: VoteResultsContent): string {
  if (content.position_breakdown.length === 0 || content.participation_count === 0) {
    return "No participation recorded.";
  }
  const top = content.position_breakdown[0];
  return `${top.option_label}: ${top.count} of ${content.participation_count} (${top.percentage}%)`;
}
