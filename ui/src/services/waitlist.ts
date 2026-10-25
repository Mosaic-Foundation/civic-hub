import { request } from "./http";

export interface JoinWaitlistOptions {
  /** Optional — the form never requires it. */
  name?: string;
  notes?: string;
  /** "I'd like to be a test user" — asks to be approved onto the beta allowlist. */
  wantsTestUser?: boolean;
}

export function joinWaitlist(
  email: string,
  options: JoinWaitlistOptions = {},
): Promise<{ message: string }> {
  return request("POST", "/waitlist", {
    email,
    name: options.name || undefined,
    notes: options.notes || undefined,
    wants_test_user: options.wantsTestUser ?? false,
  }, { token: null });
}
