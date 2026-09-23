// Who a hub that is not yet live is allowed to email.
//
// THE PROBLEM THIS SOLVES. A demo hub and a hub in private beta both hold
// real addresses — seeded fixtures, people who signed up, a county board
// roster copied from production. The moment such a deployment is given a
// verified sender instead of the provider's sandbox, every one of those
// addresses becomes reachable. The sandbox was doing this job by accident;
// this does it on purpose, so that replacing the sandbox is safe.
//
// THE RULE (Adam, 2026-09-23). When a hub's mode is not `live`, deliver only
// to addresses on that hub's admin roster or its beta allow list. Everything
// else is logged as suppressed and not sent. Those two lists are exactly the
// people who can sign in to a non-live hub, so the rule reads as: a hub that
// is not open to the public does not write to the public.
//
// WHAT IT DOES NOT COVER, deliberately. Outside a request there is no hub in
// scope, so a cron sends unguarded — which is correct, because production's
// Floyd is in beta and its digest must keep reaching its beta readers. The
// control for that path is HUB_CRON_ENABLED (src/config/cron.ts), which is
// off on dev. The two together are what make the dev deployment quiet: no
// scheduled work at all, and no request-triggered mail to anyone but the
// people running the hub.
//
// ONE CONSEQUENCE TO SETTLE BEFORE THIS REACHES PRODUCTION, flagged rather
// than decided here: production's Floyd is `beta`, so once this branch is
// merged its brief and vote-results delivery — which is addressed to
// officials, who are on neither list — would be suppressed. Either Floyd
// moves to `live` at launch, or `people.brief_recipients` joins the allow
// set. It is a one-line change in `allowedRecipients()` below.

import { currentHub, currentHubIdOrNull } from "../config/hubContext.js";
import { getSettingSync, hubModeSync } from "./hubSettings.js";
import { KEYS, asEmailList } from "../models/hubSettings.js";

export interface MailDecision {
  send: boolean;
  /** Why it was suppressed, for the log. Absent when it is being sent. */
  reason?: string;
}

/**
 * The addresses a non-live hub may write to: the people who run it, and the
 * people it has already let in.
 */
function allowedRecipients(): Set<string> {
  const admins = asEmailList(getSettingSync(KEYS.PEOPLE_ADMIN_EMAILS));
  const allowlist = asEmailList(getSettingSync(KEYS.BETA_ALLOWLIST));
  return new Set([...admins, ...allowlist]);
}

/**
 * May this hub send to this address right now?
 *
 * Answers `send: true` whenever there is no hub in scope, which is the cron
 * and script path — see the note above about why that is the right answer and
 * what covers it instead.
 */
export function mailDecision(recipient: string): MailDecision {
  const hub = currentHub();
  if (!hub) return { send: true };

  const mode = hubModeSync();
  if (mode === "live") return { send: true };

  const to = recipient.trim().toLowerCase();
  if (allowedRecipients().has(to)) return { send: true };

  return {
    send: false,
    reason:
      `hub "${hub.id}" is in ${mode} mode and ${to} is on neither its admin ` +
      `roster nor its allow list`,
  };
}

/**
 * Apply the decision, logging a suppression in a form that is greppable and
 * that names the hub — on a deployment serving several, "suppressed" without
 * a hub id is not an answer to anything.
 */
export function allowDelivery(recipient: string, subject: string): boolean {
  const decision = mailDecision(recipient);
  if (decision.send) return true;
  console.log(
    `[email] SUPPRESSED to=${recipient} hub=${currentHubIdOrNull() ?? "-"} ` +
      `subject=${JSON.stringify(subject)} reason=${decision.reason}`,
  );
  return false;
}
