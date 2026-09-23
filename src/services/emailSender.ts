// The "From" on everything this hub sends.
//
// TWO HALVES WITH DIFFERENT OWNERS, and conflating them is what broke Athens.
//
//   the ADDRESS  belongs to the deployment. Mail can only be sent from a
//                domain the provider has verified, and verification is an
//                operator act on the whole deployment — a hub cannot choose
//                its own sending address by writing a settings row, and a hub
//                that tries gets its mail refused. So the address comes from
//                `email.from_address` where a hub genuinely has its own
//                verified sender, and otherwise from RESEND_FROM / SMTP_FROM.
//
//   the NAME     belongs to the hub. "Athens Civic Hub (demo)" and "Floyd
//                Civic Hub" are the same mailbox wearing two names, which is
//                exactly right: the recipient sees who wrote to them, and the
//                provider sees an address it trusts.
//
// WHAT WENT WRONG (2026-09-23). The dev deployment had no RESEND_FROM at all,
// so this fell through to the Resend sandbox sender — which delivers only to
// the Resend account owner's own address. Every other recipient came back
// `403 validation_error`. Admin sign-in on Athens therefore sent nothing, and
// the only mail that arrived all morning was the one digest addressed to the
// account owner, which made the sender look like it was working.

import { getSettingSync } from "./hubSettings.js";
import { KEYS } from "../models/hubSettings.js";

/** Resend's sandbox. Reaches the account owner and nobody else. */
export const SANDBOX_SENDER = "Civic Hub <onboarding@resend.dev>";

export interface Sender {
  /** Display name, or "" when nothing names one. */
  name: string;
  /** The bare address. */
  address: string;
  /** The composed header value. */
  from: string;
}

/**
 * Split `Name <addr@host>` into its parts. A bare address has no name.
 * Anything unparseable is treated as an address, because that is what a
 * misconfigured value usually is and the provider's error is clearer than
 * ours would be.
 */
export function parseSender(raw: string): { name: string; address: string } {
  const angled = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    return {
      name: angled[1].replace(/^"(.*)"$/, "$1").trim(),
      address: angled[2].trim(),
    };
  }
  return { name: "", address: raw.trim() };
}

/**
 * Quote a display name when it contains anything RFC 5322 treats specially.
 * An unquoted comma turns one sender into two and the message is refused.
 */
function quoteName(name: string): string {
  return /[",;:<>@()\[\]\\]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
}

/**
 * The sender for the hub serving this request.
 *
 * Reads the request-scoped settings snapshot, so outside a request it answers
 * from the environment — which is what a cron or a script has always done.
 */
export function currentSender(): Sender {
  const configuredAddress = getSettingSync(KEYS.EMAIL_FROM_ADDRESS);
  const parsed = parseSender(configuredAddress ?? SANDBOX_SENDER);

  // The hub's own name wins over any name carried along in the address value,
  // because the address value is often a whole deployment's RESEND_FROM and
  // its name is the deployment's, not this hub's.
  const name = getSettingSync(KEYS.EMAIL_FROM_NAME)?.trim() || parsed.name;

  const from = name ? `${quoteName(name)} <${parsed.address}>` : parsed.address;
  return { name, address: parsed.address, from };
}

/** Is this the provider's sandbox, which reaches only the account owner? */
export function isSandboxSender(address: string): boolean {
  return /@resend\.dev$/i.test(address);
}
