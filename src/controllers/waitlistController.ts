import type { Request, Response } from "express";
import { forHub, HubDbError } from "../db/forHub.js";
import { currentHubId } from "../config/hubContext.js";
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
    // On this hub's waitlist only. The conflict target names hub_id, so a
    // second signup updates this hub's row and never another hub's.
    await forHub(currentHubId())
      .from("waitlist")
      .upsert(
        { email, name, notes, wants_test_user: wantsTestUser, created_at: createdAt },
        { onConflict: "hub_id,email" },
      );
  } catch (err) {
    // 23505 here is a global waitlist primary key (email), which only a
    // database without the post-cutover cleanup (20260926005000) has; since
    // it the key is (hub_id, email) and one address can wait for each hub.
    // Kept as a guard. Says so without naming the other hub.
    if (err instanceof HubDbError && err.code === "23505") {
      console.warn(`[waitlist] ${email} is already waiting for another hub (global key)`);
      res.status(409).json({
        error:
          "This address can't be added to this hub's waitlist yet. Please use a different address.",
      });
      return;
    }
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
