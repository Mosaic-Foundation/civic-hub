const API_BASE = import.meta.env.DEV ? "http://localhost:3000" : "/api";

export interface JoinWaitlistOptions {
  /** Optional — the form never requires it. */
  name?: string;
  notes?: string;
  /** "I'd like to be a test user" — asks to be approved onto the beta allowlist. */
  wantsTestUser?: boolean;
}

export async function joinWaitlist(
  email: string,
  options: JoinWaitlistOptions = {},
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      name: options.name || undefined,
      notes: options.notes || undefined,
      wants_test_user: options.wantsTestUser ?? false,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }

  return res.json();
}
