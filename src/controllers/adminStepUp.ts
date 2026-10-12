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
import { UnauthorizedError, ValidationError } from "../errors/index.js";
import { route } from "../http/route.js";
import { requestVerification, consumePendingCode } from "../modules/civic.auth/index.js";
import type { User } from "../modules/civic.auth/index.js";
import { clientIp } from "../utils/clientIp.js";

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
export const handleRequestStepUpCode = route(async (req, res) => {
  const user = caller(res);
  if (!user) throw new UnauthorizedError("Authentication required");
  // Counted in the same per-IP and per-address buckets as a sign-in code.
  await requestVerification(user.email, clientIp(req), "step_up");
  res.json({
    message: `A confirmation code has been sent to ${user.email}.`,
  });
});

/**
 * Consume the code the caller supplied, or answer the request with why not.
 *
 * Returns normally when the caller proved the mailbox; otherwise it THROWS
 * a typed error, which the route() wrapping the calling handler answers. The
 * check runs before any write, deliberately, so a rejected step-up leaves
 * the hub exactly as it was.
 */
export async function requireStepUpCode(
  req: Request,
  res: Response,
  rawCode: unknown,
): Promise<void> {
  const user = caller(res);
  if (!user) throw new UnauthorizedError("Authentication required");

  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!code) {
    throw new ValidationError(
      "A confirmation code is required. Request one, then submit it with the change.",
      "confirmation_code_required",
    );
  }

  // A wrong code here counts toward the same lockout as a wrong sign-in
  // code, which is the point of sharing the function rather than the rule.
  await consumePendingCode(user.email, code, clientIp(req));
}
