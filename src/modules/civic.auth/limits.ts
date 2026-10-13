// Per-IP limits on a hub's sign-in (Audit 2, Adam 2026-10-11).
//
// These cap what one network can do across every hub on the platform in an
// hour: how many codes it can have emailed, and how many codes it can try.
// Sized for a public meeting on shared Wi-Fi. Step-up codes count in the same
// buckets. The IP buckets are platform-wide, so spreading tries over many
// hubs does not multiply them.
//
// The per-address rules (three live codes, one email a minute, ten new codes
// an hour, five wrong tries per IP per address) are in ./codeRules.ts since
// the sign-in slice (2026-10-14), which also dropped the per-address request
// bucket of 5 an hour: it was the lever that let a stranger keep the owner
// from getting a code.

export const HUB_SIGN_IN_LIMITS = {
  request_code: { ip: 20 },
  verify: { ip: 40 },
} as const;
