// "Share this hub": a member's email invites (members and invites slice,
// Adam's design 2026-10-10, decisions 2026-10-14).
//
// Any signed-in member may invite several addresses at once with a message
// (prefilled from the hub's intro on the page, editable). The rules:
//
//   - A daily limit per member: MEMBER_DAILY_LIMIT addresses in any 24 hours,
//     ADMIN_DAILY_LIMIT for an admin. Every address counts, whatever became of
//     it, so the limit never tells a member which addresses already belong to
//     the hub.
//   - Never twice to one address, and never to an address that already has an
//     account here. Both are said the same way as a sent invite ("Done"), for
//     the same reason: no member learns who is a member from this form.
//   - Live hub: the invite is emailed, with a link that signs the neighbour
//     in (14 days, once) and lands on the join step.
//   - Beta hub: a member's invite sends no email; the address goes on the
//     waitlist, marked with who invited it. An admin's invite adds the address
//     to the allow list and is emailed.
//   - Demo hub: no email invites (a demo hub mails nobody but its admins);
//     the page offers the link and the share buttons only.
//   - Each request is recorded in the admin log with the addresses and what
//     became of them, never the message. The message is not stored anywhere.
//   - The message goes through the Code of Conduct check before anything is
//     sent (the cleanup slice, Adam's decisions 2026-10-16): flagged, nothing
//     is sent and the member changes it; the check can't run, nothing is sent
//     either (an invite has no human review to fall back on), and the member
//     can send without a message. An empty message, or the prefilled one left
//     as the page wrote it, is not checked: the hub wrote it.
//
// The limit and the no-repeat rule are one database call
// (take_member_invites, 20261016000000), under a lock per inviter.

import { env } from "../config/env.js";
import { currentHubId } from "../config/hubContext.js";
import { forHub } from "../db/forHub.js";
import { ForbiddenError, ValidationError } from "../errors/index.js";
import { sha256Hex, randomToken } from "../utils/hash.js";
import { sendEmail } from "../utils/email.js";
import { uiBaseUrl } from "../utils/baseUrl.js";
import { getBetaAllowlist, getSettingSync, hubDisplayNameSync, hubModeSync, KEYS, setBetaAllowlist } from "./hubSettings.js";
import { AiLimitError, admitAiCall } from "./aiBudget.js";
import { cocFakeEnabled } from "../config/devFlags.js";
import { fakeCodeOfConductCheck } from "../debug/fakeCodeOfConduct.js";
import { checkTextAgainstCoC } from "../modules/civic.assistant/service.js";
import { getHubConfig } from "../modules/civic.assistant/index.js";
import { defaultIntroBody } from "../shared/hubCopy.js";
import { hubKindOf } from "../shared/hubKind.js";
import { defaultInviteMessage, sameInviteMessage } from "../shared/inviteMessage.js";
import { recordHubAdminAudit } from "./hubAdminAudit.js";
import { personFallbackName } from "./creatorDisplay.js";

export const MEMBER_DAILY_LIMIT = 10;
export const ADMIN_DAILY_LIMIT = 50;
export const INVITE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INVITE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Addresses in one request; more than a day's limit is pointless. */
export const MAX_ADDRESSES_PER_REQUEST = ADMIN_DAILY_LIMIT;
export const MAX_MESSAGE_LENGTH = 1000;

const EMAIL_SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface Inviter {
  id: string;
  email: string;
  full_name: string | null;
  /** On the admin roster, with a code-proved session. */
  isAdmin: boolean;
}

export interface InviteResult {
  /** What the addresses that went through became: emailed, or put on the waitlist. */
  outcome: "emailed" | "waitlisted";
  /** Addresses handled: invited now, or already invited or here (not told apart). */
  done: number;
  /** Addresses past today's limit, in the order given; nothing was done with them. */
  over_limit: string[];
  /** Emails that could not be sent; their addresses may be invited again. */
  failed: number;
  limit: number;
}

/**
 * The addresses in what was typed: separated by commas, semicolons, spaces or
 * new lines, lower-cased, each once. A malformed one refuses the whole
 * request, so nothing is half-sent.
 */
export function parseAddresses(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.filter((v): v is string => typeof v === "string").join(",") : input;
  if (typeof raw !== "string") throw new ValidationError("Enter at least one email address.", "invite_no_addresses");
  const seen = new Set<string>();
  const out: string[] = [];
  const bad: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().replace(/^<|>$/g, "").toLowerCase();
    if (!email) continue;
    if (!EMAIL_SHAPE.test(email) || email.length > 254) {
      bad.push(part.trim());
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  if (bad.length) {
    throw new ValidationError(
      `${bad.length === 1 ? "This doesn't look like an email address" : "These don't look like email addresses"}: ${bad.slice(0, 5).join(", ")}.`,
      "invite_bad_address",
    );
  }
  if (out.length === 0) throw new ValidationError("Enter at least one email address.", "invite_no_addresses");
  if (out.length > MAX_ADDRESSES_PER_REQUEST) {
    throw new ValidationError(`Up to ${MAX_ADDRESSES_PER_REQUEST} addresses at a time.`, "invite_too_many");
  }
  return out;
}

export function cleanMessage(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "string") throw new ValidationError("The message must be text.", "invite_bad_message");
  const message = input.replace(/\r\n?/g, "\n").trim();
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Keep the message under ${MAX_MESSAGE_LENGTH} characters.`, "invite_bad_message");
  }
  return message;
}

/** Where the invite's Join button goes: the sign-in link page, the token after `#`. */
export function inviteLink(token: string): string {
  return `${uiBaseUrl()}/sign-in#invite=${token}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface InviteEmailInput {
  hubName: string;
  hubUrl: string;
  inviterName: string;
  message: string;
  link: string;
}

/** The invite, rendered. Pure, so a test reads exactly what is sent. */
export function renderInviteEmail(input: InviteEmailInput): { subject: string; text: string; html: string } {
  const { hubName, hubUrl, inviterName, message, link } = input;
  const subject = `${inviterName} invited you to ${hubName}`;
  const footer =
    `You got this because ${inviterName}, a member of ${hubName}, entered your address. ` +
    "This hub won't send you another invite. The link works once and lasts 14 days; after that you can still join at " +
    `${hubUrl}.`;
  const text = [
    `${inviterName} invited you to join ${hubName}.`,
    "",
    ...(message ? [message, ""] : []),
    `Join ${hubName}: ${link}`,
    "",
    footer,
  ].join("\n");
  const paragraphs = message
    ? message
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 12px;padding-left:12px;border-left:3px solid #d0d7de">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("\n")
    : "";
  const html = [
    `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(hubName)}</strong>.</p>`,
    paragraphs,
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#1f6feb;color:#ffffff;text-decoration:none;font-weight:600">Join ${escapeHtml(hubName)}</a></p>`,
    `<p style="color:#57606a;font-size:13px">${escapeHtml(footer)}</p>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, text, html };
}

/** The message as "Share this hub" prefills it for this hub. */
function prefilledMessage(): string {
  const intro =
    getSettingSync(KEYS.COPY_INTRO_BODY) ??
    defaultIntroBody({
      kind: hubKindOf(getSettingSync(KEYS.IDENTITY_HUB_KIND)),
      jurisdictionType: getSettingSync(KEYS.IDENTITY_JURISDICTION_TYPE),
      hubName: hubDisplayNameSync(),
      residentNoun: getSettingSync(KEYS.COPY_RESIDENT_NOUN),
    });
  return defaultInviteMessage(intro);
}

/** The label a finding names, as the check and the panel show it. */
export const INVITE_MESSAGE_FIELD = "Your message";

/**
 * The Code of Conduct check on an invite's message, before anything is sent.
 * Throws `code_of_conduct_flagged` (with the findings) or
 * `code_of_conduct_unavailable`; a member over their own hourly count gets the
 * AI limit's 429, as on Submit.
 */
async function checkInviteMessage(inviterId: string, message: string): Promise<void> {
  if (!message || sameInviteMessage(message, prefilledMessage())) return;
  const fields = [{ label: INVITE_MESSAGE_FIELD, text: message }];
  let suggestions;
  try {
    await admitAiCall("review", inviterId);
    suggestions = cocFakeEnabled() ? fakeCodeOfConductCheck(fields) : await checkTextAgainstCoC(fields, await getHubConfig());
  } catch (err) {
    if (err instanceof AiLimitError && !err.budget) throw err;
    console.error("[coc-check:invite] unavailable, nothing sent:", err instanceof Error ? err.message : err);
    throw new ValidationError(
      "The Code of Conduct check couldn't run, so nothing was sent. Send without a message, or try again later.",
      "code_of_conduct_unavailable",
    );
  }
  const findings = suggestions
    .filter((s) => s.severity === "hard" && !s.check_unavailable)
    .map((s) => ({ field: s.field, quoted_text: s.quoted_text, message: s.message }));
  if (findings.length > 0) {
    throw new ValidationError(
      "The Code of Conduct check found something to change in your message. Nothing was sent.",
      "code_of_conduct_flagged",
      { extra: { findings } },
    );
  }
}

interface TakenRow {
  email: string;
  status: "new" | "skipped" | "over_limit";
}

/** Send a member's invites, in the hub in scope. */
export async function sendMemberInvites(inviter: Inviter, addresses: string[], message: string): Promise<InviteResult> {
  const mode = hubModeSync();
  if (mode === "demo") {
    throw new ForbiddenError(
      "A demo hub doesn't send invites by email. Copy the link or use a share button instead.",
      "invite_demo_hub",
    );
  }
  const outcome: InviteResult["outcome"] = mode === "beta" && !inviter.isAdmin ? "waitlisted" : "emailed";
  // Only an emailed invite carries the message; a waitlisted one sends none.
  if (outcome === "emailed") await checkInviteMessage(inviter.id, message);
  const limit = inviter.isAdmin ? ADMIN_DAILY_LIMIT : MEMBER_DAILY_LIMIT;
  const hubId = currentHubId();
  const hub = forHub(hubId);

  const tokens = addresses.map(() => (outcome === "emailed" ? randomToken() : null));
  const taken = await hub.rpc<TakenRow[]>("take_member_invites", {
    p_user_id: inviter.id,
    p_emails: addresses,
    p_link_hashes: tokens.map((t) => (t ? sha256Hex(t) : null)),
    p_outcome: outcome,
    p_expires_at: new Date(Date.now() + INVITE_LINK_TTL_MS).toISOString(),
    p_limit: limit,
    p_window_seconds: Math.round(INVITE_WINDOW_MS / 1000),
  });
  const statusOf = new Map(taken.map((r) => [r.email, r.status]));
  const fresh = addresses.filter((a) => statusOf.get(a) === "new");
  const overLimit = addresses.filter((a) => statusOf.get(a) === "over_limit");

  let failed = 0;
  if (fresh.length > 0 && outcome === "waitlisted") {
    // On the waitlist, marked. Someone who already asked keeps their own entry.
    await hub
      .from("waitlist")
      .upsert(
        fresh.map((email) => ({ email, invited_by: inviter.id })),
        { onConflict: "hub_id,email", ignoreDuplicates: true },
      );
  }
  if (fresh.length > 0 && outcome === "emailed") {
    if (mode === "beta") {
      // An admin's invite lets the address in (Adam, 2026-10-14).
      const current = await getBetaAllowlist(hubId);
      await setBetaAllowlist(hubId, [...current, ...fresh], inviter.id);
    }
    const hubName = hubDisplayNameSync();
    const hubUrl = uiBaseUrl();
    const inviterName = inviter.full_name?.trim() || personFallbackName();
    for (const email of fresh) {
      const token = tokens[addresses.indexOf(email)]!;
      const rendered = renderInviteEmail({ hubName, hubUrl, inviterName, message, link: inviteLink(token) });
      if (!(await deliver(email, rendered))) {
        failed += 1;
        // Not delivered, so not invited: the address may be tried again.
        await hub.from("hub_invites").delete().eq("email", email).eq("outcome", "emailed").is("used_at", null);
      }
    }
  }

  await recordHubAdminAudit({
    actor: inviter.email,
    action: "member.invite",
    after: {
      outcome,
      invited: fresh,
      already_invited_or_member: addresses.filter((a) => statusOf.get(a) === "skipped"),
      over_limit: overLimit,
      ...(failed ? { not_delivered: failed } : {}),
    },
  });

  return { outcome, done: addresses.length - overLimit.length - failed, over_limit: overLimit, failed, limit };
}

async function deliver(to: string, message: { subject: string; text: string; html: string }): Promise<boolean> {
  try {
    if (!env.RESEND_API_KEY) {
      // Local development: show what would have gone, as the mailer does.
      console.log(`---- [member-invite] RESEND_API_KEY unset — logging email ----\nTo: ${to}\nSubject: ${message.subject}\n\n${message.text}\n---- end ----`);
      return true;
    }
    const result = await sendEmail({ to, ...message, purpose: "member_invite" });
    return result.sent;
  } catch (err) {
    console.error(`[member-invite] ${to}:`, err);
    return false;
  }
}
