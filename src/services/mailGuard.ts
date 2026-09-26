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
// SCHEDULED JOBS ARE COVERED TOO. Since Phase 2c every job runs inside its
// hub's scope (src/jobs/runJob.ts), so the digest of a beta hub reaches only
// its admin roster and allow list. Under `main` the digest had no guard, so a
// subscriber on neither list (someone who joined before the allow list
// existed) was mailed anyway; after cutover they are not. Check a hub before
// cutover with `scripts/check-digest-recipients.ts --hub <slug>`: on
// production's copy it found 3 of Floyd's 28 subscribers on neither list
// (2026-09-25), fixed by adding them to the allow list. Only a path with no
// hub in scope at all (a script) sends unguarded. HUB_CRON_ENABLED
// (src/config/cron.ts), off on dev, is what keeps the dev deployment's
// scheduled work from running at all.
//
// BRIEFS ARE NOT DELIVERED FROM A BETA HUB, AND THAT IS INTENDED (Adam,
// 2026-09-23). Production's Floyd is `beta`, so its brief and vote-results
// delivery — addressed to officials, who are on neither list — is suppressed
// until Floyd goes live. Asked about it directly and the answer was that
// briefs only need to go out in live mode, which is coherent: a brief is a
// hub telling its elected officials what its residents decided, and a hub
// still in private beta has not yet asked its residents anything it should be
// sending anyone.
//
// So do NOT add `people.brief_recipients` to the allow set to "fix" this. It
// is the behaviour that was chosen. What makes it safe is that the
// suppression is loud: every withheld message logs `[email] SUPPRESSED` with
// the hub and the reason, so a brief that does not arrive is visible in the
// log rather than silently missing.

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
