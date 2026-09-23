// Proving, right now, that the caller holds the mailbox.
//
// A handful of admin acts change what the hub IS rather than what it holds:
// moving it between beta and live, and adding or removing an administrator.
// An open admin tab should not be enough for either. The caller has to supply
// a code sent to their address at the time of the act, which is the same
// one-time code the sign-in flow uses, checked by the same function — so the
// lockout, the expiry, the wrong-guess counter and the single-use rule are
// not reimplemented here in a weaker form.
//
// WHICH ACTS. Mode, because demo turns off email verification. The admin
// roster, because an attacker with a live admin session who can add an admin
// has made their access permanent, and one who can remove the others has
// made it exclusive. Everything else on the settings page is recoverable by
// an admin who still has their account.
//
// Requesting a code goes through the ORDINARY sign-in request, which already
// throttles and which always sends a real email to a privileged account even
// on a demo hub — so this path cannot be used to skip verification either.

import type { Request, Response } from "express";
import { requestVerification, consumePendingCode } from "../modules/civic.auth/index.js";
import type { User } from "../modules/civic.auth/index.js";

export function caller(res: Response): User | undefined {
  return res.locals.authUser as User | undefined;
}

/**
 * Send the caller a fresh code for a step-up act.
 *
 * One handler, mounted on a path per act, so the client asks for a code for
 * the thing it is about to do and the server logs which. The code itself is
 * not scoped to the act: it is proof of the mailbox, and the act is
 * authorized by the admin session that accompanies it.
 */
export async function handleRequestStepUpCode(
  _req: Request,
  res: Response,
): Promise<void> {
  const user = caller(res);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    await requestVerification(user.email);
    res.json({
      message: `A confirmation code has been sent to ${user.email}.`,
    });
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}

/**
 * Consume the code the caller supplied, or answer the request with why not.
 *
 * Returns true when the caller proved the mailbox. A false return means a
 * response has ALREADY been sent, so the caller returns immediately and
 * touches nothing — the check runs before any write, deliberately, so a
 * rejected step-up leaves the hub exactly as it was.
 */
export async function requireStepUpCode(
  res: Response,
  rawCode: unknown,
): Promise<boolean> {
  const user = caller(res);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }

  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!code) {
    res.status(400).json({
      error:
        "A confirmation code is required. Request one, then submit it with the change.",
    });
    return false;
  }

  try {
    // A wrong code here counts toward the same lockout as a wrong sign-in
    // code, which is the point of sharing the function rather than the rule.
    await consumePendingCode(user.email, code);
    return true;
  } catch (err) {
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Unknown error" });
    return false;
  }
}
