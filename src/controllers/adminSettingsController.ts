// Admin settings controller — read/write admin-configurable hub settings.
//
// Exposes:
//   - brief_recipient_emails  (Slice 3 addendum — recipients of vote
//                              results, sent to the Board on approval.
//                              Field name preserved across Slice 8.5's
//                              civic.brief → civic.vote_results rename
//                              so existing operator config keeps working.)
//   - officials               ({email, name?, official_type,
//                              official_title} roster. Writes the managed
//                              official role onto users rows. Designating
//                              someone an official also grants
//                              announcement posting — identity and that
//                              capability are deliberately fused for now.)
//   - announcement_authors    (Slice 4.1, SUPERSEDED by `officials`.
//                              Still returned read-only so an operator
//                              can see what the legacy list held; the
//                              first save of `officials` retires it.)
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
  hubModeFor,
} from "../services/hubSettings.js";
import {
  type OfficialRecord,
  listOfficialsWithLegacy,
  setOfficials,
} from "../services/officials.js";
import { getAuthUser } from "../middleware/auth.js";
import { currentHub, currentHubId } from "../config/hubContext.js";

interface SettingsResponse {
  // The hub's name, tagline, label, operator, contact address and "who runs
  // this site" moved to GET/PUT /admin/hub/settings on 2026-09-24, so every
  // key on the Settings page has exactly one writer. See
  // src/controllers/hubSettingsController.ts.

  /**
   * The hub's lifecycle mode, read-only here. It is CHANGED through
   * POST /admin/hub/mode, which takes a fresh emailed code — see
   * src/controllers/hubModeController.ts. It is reported here so the admin
   * page can show the current state and re-read it after a change.
   */
  mode: string;

  brief_recipient_emails: string[];
  officials: OfficialRecord[];
  /** @deprecated superseded by `officials`; read-only. */
  announcement_authors: AnnouncementAuthor[];
  beta_allowlist: string[];
  waitlist: WaitlistEntry[];
  support_threshold: number;
  comment_identity_mode: CommentIdentityMode;
}

async function loadSettings(): Promise<SettingsResponse> {
  const hubId = currentHubId();
  return {
    mode: hubModeFor(currentHub()),
    brief_recipient_emails: await getVoteResultsRecipients(hubId),
    officials: await listOfficialsWithLegacy(),
    announcement_authors: await getAnnouncementAuthors(hubId),
    beta_allowlist: await getBetaAllowlist(hubId),
    waitlist: await getWaitlist(),
    support_threshold: await getSupportThreshold(hubId),
    comment_identity_mode: await getCommentIdentityMode(hubId),
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
      officials?: unknown;
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
      await setVoteResultsRecipients(currentHubId(), input, actor);
    }

    if (body.officials !== undefined) {
      if (!Array.isArray(body.officials)) {
        res.status(400).json({
          error:
            "officials must be an array of { email, name?, official_type, official_title } objects.",
        });
        return;
      }
      // setOfficials() normalizes and validates: it drops rows with no
      // email or no title (the DB's both-or-neither CHECK), narrows an
      // unrecognized type to "other" rather than rejecting the save, and
      // demotes any account absent from the list.
      await setOfficials(body.officials, actor);
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
      await setAnnouncementAuthors(currentHubId(), input, actor);
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
      await setBetaAllowlist(currentHubId(), input, actor);
    }

    if (body.support_threshold !== undefined) {
      const n = Number(body.support_threshold);
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({
          error: "support_threshold must be a number >= 0 (0 skips the support phase).",
        });
        return;
      }
      await setSupportThreshold(currentHubId(), n, actor);
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
      await setCommentIdentityMode(currentHubId(), body.comment_identity_mode, actor);
    }

    res.json(await loadSettings());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
