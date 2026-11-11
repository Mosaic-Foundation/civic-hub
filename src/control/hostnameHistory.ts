// A hostname a hub used before hubs.previous_hostnames existed (20261008000000)
// is recorded only in the console's audit log, as a hub.update's `before`. It
// stays taken, like every hostname a hub has had: old links, published
// events and DID documents point at it. The hub checks its own registry
// (src/operator/hubs.ts → hostnameTakenBy); this is the console's half,
// checked before it asks the hub to create a hub or change an address (the
// console split, step 3c).

import { q } from "./db.js";
import { ControlInputError } from "./errors.js";

/** Refuse a hostname another hub had, by the console's audit log. */
export async function refusePastHostname(hostname: string | undefined, exceptHubId?: string): Promise<void> {
  if (!hostname) return;
  const { rows } = await q<{ target_hub_id: string | null }>(
    `SELECT target_hub_id FROM console.control_audit_log
      WHERE action = 'hub.update' AND before->>'hostname' = $1 AND target_hub_id IS DISTINCT FROM $2
      LIMIT 1`,
    [hostname.toLowerCase(), exceptHubId ?? null],
  );
  if (rows[0]) {
    throw new ControlInputError(`"${hostname}" was hub "${rows[0].target_hub_id}"'s hostname. A hostname a hub has used stays taken.`, 409);
  }
}
