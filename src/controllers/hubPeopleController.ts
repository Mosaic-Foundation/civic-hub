// Who administers this hub, and who sits on its board.
//
//   POST /admin/hub/people/request-code   emails the caller a code
//   POST /admin/hub/people                { admin_emails, board_emails, code }
//
// ADMINS ARE DATA, NOT DEPLOYMENT CONFIGURATION. `people.admin_emails` and
// `people.board_emails` are hub_settings rows and the settings reader already
// resolves the row before the environment; CIVIC_ADMIN_EMAILS survives as the
// bootstrap only — the answer for a hub that has no row yet, which is how a
// fresh deployment gets its first administrator. Once a hub has written a
// roster, the environment variable has no say in it. That is what makes an
// Athens admin a different person from a Floyd admin on one deployment, and
// what lets an operator add a colleague without a redeploy.
//
// WHY THIS IS NOT PART OF PATCH /admin/settings. Everything on that endpoint
// is recoverable by an admin who still has their account. This is not: an
// attacker holding a live admin session who can add an admin has made their
// access permanent, and one who can remove the others has made it exclusive.
// So it takes a fresh emailed code, the same step-up a mode change takes.
//
// THE LAST ADMIN CANNOT BE REMOVED. A hub with an empty roster has no one who
// can put an administrator back: requireAdmin fails closed, so every /admin
// route answers 503 and the only repair is a database write. The guard is on
// the RESOLVED list rather than the submitted one, because a submission of
// nothing but blank strings is the same mistake with more typing.

import type { Request, Response } from "express";
import { currentHubId } from "../config/hubContext.js";
import {
  adminsAreFromEnv,
  getAdminEmails,
  getBoardEmails,
  setAdminEmails,
  setBoardEmails,
} from "../services/hubSettings.js";
import { caller, requireStepUpCode } from "./adminStepUp.js";

export interface HubPeopleResponse {
  admin_emails: string[];
  board_emails: string[];
  /** True while the roster is still coming from CIVIC_ADMIN_EMAILS. */
  admins_from_env: boolean;
}

/** Trim, drop blanks, lowercase, dedupe. Anything not a string is not an email. */
function cleanEmails(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const email = entry.trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`"${entry.trim()}" is not an email address.`);
    }
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export async function handleGetHubPeople(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    res.json(await loadPeople());
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

async function loadPeople(): Promise<HubPeopleResponse> {
  const hubId = currentHubId();
  const [admin_emails, board_emails] = await Promise.all([
    getAdminEmails(hubId),
    getBoardEmails(hubId),
  ]);
  return {
    admin_emails,
    board_emails,
    admins_from_env: await adminsAreFromEnv(hubId),
  };
}

export async function handleSetHubPeople(
  req: Request,
  res: Response,
): Promise<void> {
  const user = caller(res);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (req.body ?? {}) as {
    admin_emails?: unknown;
    board_emails?: unknown;
    code?: unknown;
  };

  // Shape and rules first, so a rejected change never spends a code.
  let admins: string[] | null;
  let board: string[] | null;
  try {
    admins = body.admin_emails === undefined ? null : cleanEmails(body.admin_emails);
    board = body.board_emails === undefined ? null : cleanEmails(body.board_emails);
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Invalid email list" });
    return;
  }
  if (body.admin_emails !== undefined && admins === null) {
    res.status(400).json({ error: "admin_emails must be an array of strings." });
    return;
  }
  if (body.board_emails !== undefined && board === null) {
    res.status(400).json({ error: "board_emails must be an array of strings." });
    return;
  }
  if (admins !== null && admins.length === 0) {
    res.status(400).json({
      error:
        "A hub must keep at least one admin. Add the replacement first, then remove yourself.",
    });
    return;
  }

  if (!(await requireStepUpCode(res, body.code))) return;

  const hubId = currentHubId();
  try {
    if (admins !== null) {
      const before = await getAdminEmails(hubId);
      await setAdminEmails(hubId, admins, user.id);
      logRosterChange("admin", hubId, user.email, before, admins);
    }
    if (board !== null) {
      const before = await getBoardEmails(hubId);
      await setBoardEmails(hubId, board, user.id);
      logRosterChange("board", hubId, user.email, before, board);
    }
    res.json(await loadPeople());
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/**
 * Say who changed whose access, and how.
 *
 * There is no event for this — `emitEvent` publishes civic activity and an
 * admin roster is not one — so the deployment log is the only record, and a
 * line that names the actor and the delta is what makes it a usable one.
 */
function logRosterChange(
  which: "admin" | "board",
  hubId: string,
  actor: string,
  before: readonly string[],
  after: readonly string[],
): void {
  const added = after.filter((e) => !before.includes(e));
  const removed = before.filter((e) => !after.includes(e));
  if (added.length === 0 && removed.length === 0) return;
  console.log(
    `[hub] ${which} roster changed on ${hubId} by ${actor}: ` +
      `+[${added.join(", ")}] -[${removed.join(", ")}] (${after.length} total)`,
  );
}
