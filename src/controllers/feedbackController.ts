// Feedback controller — handles POST /feedback.
//
// Anonymous or authenticated. Bearer token (if present and valid)
// resolves to a user_id stored on the submission for triage. Honeypot
// field `website` silently discards spam — returns 200 with a normal
// shape so bots can't probe the difference.

import type { Request, Response } from "express";
import { getUserFromToken } from "../modules/civic.auth/index.js";
import {
  FeedbackValidationError,
  submitFeedback,
} from "../modules/civic.feedback/index.js";

const MESSAGE_MAX_LEN = 4000;

export async function handleSubmitFeedback(
  req: Request,
  res: Response,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Honeypot — a bot will dutifully fill every input. Real users never
  // see this field. Discard silently and return success.
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    res.json({ message: "Thanks for the feedback." });
    return;
  }

  const category = body.category;
  const message = body.message;
  const name = typeof body.name === "string" ? body.name : null;
  const email = typeof body.email === "string" ? body.email : null;
  const screenshotUrl = typeof body.screenshot_url === "string" ? body.screenshot_url : null;

  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > MESSAGE_MAX_LEN) {
    res.status(400).json({
      error: `message must be ${MESSAGE_MAX_LEN} characters or fewer`,
    });
    return;
  }

  // Optional bearer-token resolution. Failure short of an authenticated
  // identification falls back to anonymous — keeps the endpoint open
  // to non-signed-in users.
  let userId: string | null = null;
  let resolvedName = name;
  let resolvedEmail = email;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const user = await getUserFromToken(token);
    if (user) {
      userId = user.id;
      if (!resolvedEmail) resolvedEmail = user.email;
      if (!resolvedName && user.display_name) resolvedName = user.display_name;
    }
  }

  const userAgentHeader = req.headers["user-agent"];
  const userAgent = typeof userAgentHeader === "string" ? userAgentHeader : null;

  try {
    const submission = await submitFeedback({
      category: category as never, // service-level validation will reject invalids
      message,
      name: resolvedName,
      email: resolvedEmail,
      user_id: userId,
      user_agent: userAgent,
      screenshot_url: screenshotUrl,
    });
    res.json({
      message: "Thanks for the feedback.",
      submission_id: submission.id,
    });
  } catch (err) {
    if (err instanceof FeedbackValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[feedback] submit failed: ${msg}`);
    res.status(500).json({ error: "Could not save feedback" });
  }
}
