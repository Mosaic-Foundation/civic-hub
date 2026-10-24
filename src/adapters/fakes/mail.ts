// The `mail` adapter's fake (ADR-012): an in-memory outbox.
//
// Not configured by default, so every flow behaves exactly as a keyless
// deployment does (codes and invites logged, counted as sent): that is what
// CI has always tested. A test that wants delivery installs
// fakeMail({ configured: true }) and reads `outbox`.

import type { MailTransport, OutgoingMail } from "../mail.js";

export interface FakeMail extends MailTransport {
  outbox: OutgoingMail[];
}

export function fakeMail(opts: { configured?: boolean; fail?: (m: OutgoingMail) => string | null } = {}): FakeMail {
  const outbox: OutgoingMail[] = [];
  return {
    name: "fake",
    outbox,
    configured: () => opts.configured ?? false,
    notConfiguredReason: () => "RESEND_API_KEY is not configured",
    defaultSender: () => "Civic Hub <noreply@mail.fake.invalid>",
    isSandboxSender: () => false,
    async send(message) {
      const failure = opts.fail?.(message) ?? null;
      if (failure) return { sent: false, error: failure };
      outbox.push(message);
      return { sent: true, id: `fake-${outbox.length}` };
    },
  };
}
