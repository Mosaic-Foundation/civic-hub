// offices: the space's accountable people as a package meets them (kernel
// step 1, docs/kernel/SURFACE.md, "Callers" and "Offices"). The kernel keeps
// who holds an office (src/services/officials.ts) and who a space's results
// go to; since Briefs, a package lets an official go on the record and sends
// a result to its recipients through these, never the hub's tables.

import type { Response } from "express";
import { forHub } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
import { getAdminEmailsSync, getVoteResultsRecipients } from "./hubSettings.js";
import { auditActor, recordHubAdminAudit, type HubAdminAuditAction } from "./hubAdminAudit.js";
import type { OfficialIdentity } from "../shared/officialTypes.js";

export const offices = {
  /**
   * The office the caller speaks for, as `requireOfficial` found it, or null
   * when the route was not behind that guard.
   */
  officialOf(res: Response): OfficialIdentity | null {
    return (res.locals.officialIdentity as OfficialIdentity | undefined) ?? null;
  },

  /**
   * The names of people who went on the record (an official's response), by
   * account id: their full name, else their display name. An account with
   * neither is left out, and the caller shows the office instead; an email is
   * never shown. A failed read leaves them all out.
   */
  async onRecordNames(accountIds: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(accountIds)];
    if (unique.length === 0) return names;
    let rows: Array<{ id: string; full_name?: string | null; display_name?: string | null }>;
    try {
      rows = await forHub(currentHubId())
        .from("users")
        .select<{ id: string; full_name?: string | null; display_name?: string | null }>("*")
        .in("id", unique);
    } catch (err) {
      console.error(`[offices] name lookup failed: ${(err as Error).message}`);
      return names;
    }
    for (const row of rows) {
      const name = row.full_name?.trim() || row.display_name?.trim() || "";
      if (name) names.set(row.id, name);
    }
    return names;
  },

  /**
   * Who the space's results go to when the admin reviewing one chose nobody
   * (the Officials settings' "brief recipients"), deduplicated.
   */
  resultRecipients(): Promise<string[]> {
    return getVoteResultsRecipients(currentHubId());
  },

  /** The space's admins' addresses (its people.admin_emails), for a plugin that tells them something. */
  adminEmails(): string[] {
    return [...getAdminEmailsSync()];
  },
};

/**
 * Record an admin's act in the hub's admin log (who, what, and what it
 * changed). Since Briefs: regenerating a result and publishing a new version.
 */
export function recordAdminAct(
  admin: { id: string; email: string | null },
  action: HubAdminAuditAction,
  after: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<void> {
  return recordHubAdminAudit({ actor: auditActor(admin), action, after, ...(before ? { before } : {}) });
}
