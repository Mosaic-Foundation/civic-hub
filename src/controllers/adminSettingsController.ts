// Admin settings controller — read/write admin-configurable hub settings.
//
// Exposes:
//   - brief_recipient_emails  (Slice 3 addendum — recipients of vote
//                              results, sent to the Board on approval.
//                              Field name preserved across Slice 8.5's
//                              civic.brief → civic.vote_results rename
//                              so existing operator config keeps working.)
//   - announcement_authors    (Slice 4.1: {email, name?, label} list of
//                              non-admin users authorized to post
//                              announcements; name is admin-curated)
//
// More settings can be added by extending SettingsResponse + the PATCH
// body handler.

import { Request, Response } from "express";
import {
  type AnnouncementAuthor,
  type WaitlistEntry,
  type CommentIdentityMode,
  getAnnouncementAuthors,
  getVoteResultsRecipients,
  setAnnouncementAuthors,
  setVoteResultsRecipients,
  getBetaAllowlist,
  setBetaAllowlist,
  getWaitlist,
  getSupportThreshold,
  setSupportThreshold,
  getCommentIdentityMode,
  setCommentIdentityMode,
} from "../services/hubSettings.js";
import { getAuthUser } from "../middleware/auth.js";

interface SettingsResponse {
  brief_recipient_emails: string[];
  announcement_authors: AnnouncementAuthor[];
  beta_allowlist: string[];
  waitlist: WaitlistEntry[];
  support_threshold: number;
  comment_identity_mode: CommentIdentityMode;
}

async function loadSettings(): Promise<SettingsResponse> {
  return {
    brief_recipient_emails: await getVoteResultsRecipients(),
    announcement_authors: await getAnnouncementAuthors(),
    beta_allowlist: await getBetaAllowlist(),
    waitlist: await getWaitlist(),
    support_threshold: await getSupportThreshold(),
    comment_identity_mode: await getCommentIdentityMode(),
  };
}

export async function handleGetSettings(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    res.json(await loadSettings());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handlePatchSettings(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const actor = getAuthUser(res).id;
    const body = (req.body ?? {}) as {
      brief_recipient_emails?: unknown;
      announcement_authors?: unknown;
      beta_allowlist?: unknown;
      support_threshold?: unknown;
      comment_identity_mode?: unknown;
    };

    if (body.brief_recipient_emails !== undefined) {
      if (!Array.isArray(body.brief_recipient_emails)) {
        res.status(400).json({
          error: "brief_recipient_emails must be an array of strings.",
        });
        return;
      }
      const input = body.brief_recipient_emails.filter(
        (e): e is string => typeof e === "string",
      );
      await setVoteResultsRecipients(input, actor);
    }

    if (body.announcement_authors !== undefined) {
      if (!Array.isArray(body.announcement_authors)) {
        res.status(400).json({
          error:
            "announcement_authors must be an array of { email, label } objects.",
        });
        return;
      }
      const input: AnnouncementAuthor[] = [];
      for (const entry of body.announcement_authors) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as { email?: unknown; name?: unknown; label?: unknown };
        if (typeof e.email === "string" && typeof e.label === "string") {
          const name = typeof e.name === "string" ? e.name : undefined;
          input.push(name ? { email: e.email, name, label: e.label } : { email: e.email, label: e.label });
        }
      }
      await setAnnouncementAuthors(input, actor);
    }

    if (body.beta_allowlist !== undefined) {
      if (!Array.isArray(body.beta_allowlist)) {
        res.status(400).json({
          error: "beta_allowlist must be an array of email strings.",
        });
        return;
      }
      const input = body.beta_allowlist.filter(
        (e): e is string => typeof e === "string",
      );
      await setBetaAllowlist(input, actor);
    }

    if (body.support_threshold !== undefined) {
      const n = Number(body.support_threshold);
      if (!Number.isFinite(n) || n < 1) {
        res.status(400).json({
          error: "support_threshold must be a number >= 1.",
        });
        return;
      }
      await setSupportThreshold(n, actor);
    }

    if (body.comment_identity_mode !== undefined) {
      if (typeof body.comment_identity_mode !== "string") {
        res.status(400).json({
          error:
            "comment_identity_mode must be one of: real_name, anonymous_optional, anonymous_only.",
        });
        return;
      }
      // setCommentIdentityMode validates the value and throws on junk.
      await setCommentIdentityMode(body.comment_identity_mode, actor);
    }

    res.json(await loadSettings());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
