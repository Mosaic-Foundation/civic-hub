// Requests to the super admin (src/control/): the console hostname in Host,
// its session cookie, and the X-Civic-Console header every write needs.
// The operator's codes and sessions are written straight into the local
// stack as the service role, as mintSession() does for a hub's. The request
// and the session are the conformance suite's own (kit/conformance).

import { createHash } from "node:crypto";
import { localRest } from "./adminSession.js";
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
  await localRest(`platform_sign_in_codes?realm=eq.console&purpose=eq.${purpose}&email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  await localRest("platform_sign_in_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      realm: "console",
      email,
      purpose,
      code_hash: sha256(code),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      created_at: new Date(Date.now() - 60 * 1000).toISOString(),
      attempts: 0,
    }),
  });
}

export interface AuditRowForTest {
  action: string;
  actor_email: string;
  target_hub_id: string | null;
  before: any;
  after: any;
}

export async function auditFor(hubId: string): Promise<AuditRowForTest[]> {
  return (await localRest(
    `control_audit_log?target_hub_id=eq.${hubId}&select=action,actor_email,target_hub_id,before,after&order=id.asc`,
  )) as AuditRowForTest[];
}
