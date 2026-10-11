// Per-IP and per-address limits on a hub's sign-in (Audit 2, Adam 2026-10-11).
//
// On top of the code's own rules in ./otp.ts (30 s between requests for an
// address, five wrong tries lock it for 15 minutes), these cap what one
// network can do across every hub on the platform in an hour: how many codes
// it can have emailed, and how many codes it can try. Sized for a public
// meeting on shared Wi-Fi. Step-up codes count in the same buckets.
//
// The IP buckets are platform-wide, so spreading tries over many hubs does
// not multiply them. The address bucket is per hub, as an account is.

import { HOUR_MS, RateLimitedError, takeRateLimit } from "../../db/rateLimit.js";

export const HUB_SIGN_IN_LIMITS = {
  request_code: { ip: 20, email: 5 },
  verify: { ip: 40 },
} as const;

export const TOO_MANY_FROM_HERE =
  "Too many sign-in attempts from this network. Please wait an hour and try again.";
export const TOO_MANY_FOR_ADDRESS =
  "Too many codes have been sent to this address. Please wait an hour and try again.";

/** Count a code request, or throw RateLimitedError. */
export async function limitCodeRequest(ip: string, hubId: string, email: string): Promise<void> {
  const refused = await takeRateLimit([
    { scope: "hub.request_code", by: "ip", value: ip, limit: HUB_SIGN_IN_LIMITS.request_code.ip, windowMs: HOUR_MS },
    {
      scope: "hub.request_code",
      by: "email",
      value: `${hubId}:${email.trim().toLowerCase()}`,
      limit: HUB_SIGN_IN_LIMITS.request_code.email,
      windowMs: HOUR_MS,
    },
  ]);
  if (refused) throw new RateLimitedError(refused.by === "ip" ? TOO_MANY_FROM_HERE : TOO_MANY_FOR_ADDRESS);
}

/** Count a code typed in, or throw RateLimitedError. */
export async function limitCodeCheck(ip: string): Promise<void> {
  const refused = await takeRateLimit([
    { scope: "hub.verify", by: "ip", value: ip, limit: HUB_SIGN_IN_LIMITS.verify.ip, windowMs: HOUR_MS },
  ]);
  if (refused) throw new RateLimitedError(TOO_MANY_FROM_HERE);
}
