// civic.brief module — official-delivery email formatting
//
// Formats the brief for delivery to officials (e.g. the Board of
// Supervisors) on approval. Type-agnostic: renders headline, summary,
// participation, sections, and a sampling of resident comments, with a
// link to the public brief page. Mirrors civic.vote_results/email.ts.

import type { BriefProcessState } from "./models.js";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BriefEmailDeps {
  hubLabel: string;
  publicUrl: string;
}

export function formatBriefEmail(
  state: BriefProcessState,
  deps: BriefEmailDeps,
): { subject: string; html: string; text: string } {
  const c = state.content;
  const subject = `Civic Brief: ${c.title}`;

  const participation = c.participation_label
    ? c.participation_label
    : c.participation_count != null
      ? `${c.participation_count} participants`
      : "";

  const sectionsHtml = c.sections
    .map(
      (s) =>
        `<h3 style="margin:16px 0 4px;">${esc(s.heading)}</h3><p style="margin:0;white-space:pre-wrap;">${esc(s.body)}</p>`,
    )
    .join("");

  const commentsHtml =
    c.comments.length > 0
      ? `<h3 style="margin:16px 0 4px;">In residents' words</h3><ul>${c.comments
          .slice(0, 10)
          .map((cm) => `<li>${esc(cm)}</li>`)
          .join("")}</ul>`
      : "";

  const notesHtml = c.admin_notes.trim()
    ? `<h3 style="margin:16px 0 4px;">Notes from the ${esc(deps.hubLabel)}</h3><p style="margin:0;white-space:pre-wrap;">${esc(c.admin_notes)}</p>`
    : "";

  const html = `
    <p><strong>${esc(c.headline)}</strong></p>
    <p style="white-space:pre-wrap;">${esc(c.summary)}</p>
    ${participation ? `<p><em>${esc(participation)}</em></p>` : ""}
    ${sectionsHtml}
    ${notesHtml}
    ${commentsHtml}
    <p style="margin-top:16px;"><a href="${esc(deps.publicUrl)}">View the full brief</a></p>
  `;

  const sectionsText = c.sections
    .map((s) => `\n${s.heading}\n${s.body}`)
    .join("\n");
  const commentsText =
    c.comments.length > 0
      ? `\n\nIn residents' words:\n${c.comments
          .slice(0, 10)
          .map((cm) => `- ${cm}`)
          .join("\n")}`
      : "";
  const notesText = c.admin_notes.trim()
    ? `\n\nNotes from the ${deps.hubLabel}:\n${c.admin_notes}`
    : "";

  const text = `${c.headline}\n\n${c.summary}${participation ? `\n\n${participation}` : ""}${sectionsText}${notesText}${commentsText}\n\nView the full brief: ${deps.publicUrl}`;

  return { subject, html, text };
}
