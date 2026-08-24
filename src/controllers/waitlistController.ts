import type { Request, Response } from "express";
import { getDb } from "../db/client.js";
import { notifyAdminsOfWaitlistSignup } from "../services/waitlistNotify.js";

const NAME_MAX_LEN = 200;

/**
 * Coerce the test-user opt-in. The form posts a real boolean, but a checkbox
 * that never got serialized (older client, missing field) must read as "did
 * not opt in" rather than as truthy junk.
 */
export function readTestUserFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "on" || v === "1" || v === "yes";
  }
  return false;
}

export async function handleJoinWaitlist(
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body.website === "string" && body.website.trim().length > 0) {
    res.json({ message: "You're on the list! We'll email you when access opens up." });
    return;
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 500)
      : null;

  // Optional, and blank stays null so "no name given" is one value, not two.
  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, NAME_MAX_LEN)
      : null;

  const wantsTestUser = readTestUserFlag(body.wants_test_user);
  const createdAt = new Date().toISOString();

  try {
    const { error } = await getDb()
      .from("waitlist")
      .upsert(
        { email, name, notes, wants_test_user: wantsTestUser, created_at: createdAt },
        { onConflict: "email" },
      );
    if (error) throw error;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[waitlist] insert failed: ${msg}`);
    res.status(500).json({ error: "Could not join waitlist. Please try again." });
    return;
  }

  // Operator notification. Awaited on purpose: on serverless the function is
  // frozen the instant the response is flushed, so a fire-and-forget send
  // never leaves the box. Best-effort — a failed send is logged inside, and
  // the signup (already persisted) still reports success.
  await notifyAdminsOfWaitlistSignup({
    email,
    name,
    notes,
    wants_test_user: wantsTestUser,
    created_at: createdAt,
  }).catch((err) => {
    console.warn(
      `[waitlist] admin notification failed for ${email}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });

  res.json({ message: "You're on the list! We'll email you when access opens up." });
}
