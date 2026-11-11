// Requests to the super admin (src/control/): the console hostname in Host,
// its session cookie, and the X-Civic-Console header every write needs.
// The operator's codes and sessions are written straight into the local
// stack as the service role, as mintSession() does for a hub's. The request
// and the session are the conformance suite's own (kit/conformance).

import { createHash } from "node:crypto";
import { consoleSql } from "./consoleDb.js";
import { OPERATOR } from "../../kit/conformance/src/support/console.js";

export {
  CONSOLE_HOST,
  OPERATOR,
  consoleCall,
  mintConsoleSession,
  type ConsoleResponse,
} from "../../kit/conformance/src/support/console.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Put a known code in place, as if it had been emailed. */
export async function plantCode(purpose: "sign_in" | "step_up", code: string, email = OPERATOR): Promise<void> {
  // In place of any codes the address already has (one row per code since
  // the sign-in slice, 2026-10-14).
  await consoleSql("delete from console.platform_sign_in_codes where realm = 'console' and purpose = $1 and email = $2", [purpose, email]);
  await consoleSql(
    `insert into console.platform_sign_in_codes (realm, email, purpose, code_hash, expires_at, created_at, attempts)
     values ('console', $1, $2, $3, $4, $5, 0)`,
    [email, purpose, sha256(code), new Date(Date.now() + 10 * 60 * 1000).toISOString(), new Date(Date.now() - 60 * 1000).toISOString()],
  );
}

export interface AuditRowForTest {
  action: string;
  actor_email: string;
  target_hub_id: string | null;
  before: any;
  after: any;
}

export async function auditFor(hubId: string): Promise<AuditRowForTest[]> {
  return consoleSql<AuditRowForTest & Record<string, unknown>>(
    "select action, actor_email, target_hub_id, before, after from console.control_audit_log where target_hub_id = $1 order by id asc",
    [hubId],
  );
}
