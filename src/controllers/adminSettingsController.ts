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
  getOperatorName,
  getContactEmail,
  setOperatorName,
  setContactEmail,
  getWhoRunsThis,
  setWhoRunsThis,
  hubModeFor,
} from "../services/hubSettings.js";
import {
  type OfficialRecord,
  listOfficialsWithLegacy,
  setOfficials,
} from "../services/officials.js";
import { getAuthUser } from "../middleware/auth.js";
import { currentHub, currentHubId } from "../config/hubContext.js";
import { whoRunsThisDefault } from "../services/hubDocuments.js";

interface SettingsResponse {
  /**
   * What the legal documents will say about who runs this hub.
   *
   * `hostname` is here READ-ONLY and comes from the `hubs` row, because the
   * documents name it and an admin should be able to see what they are about
   * to publish without going and finding it. It is not editable from the hub
   * admin panel: changing which hostname a hub answers on is a control-plane
   * act, not a settings edit.
   */
  operator_name: string;
  contact_email: string;
  hostname: string;
  /**
   * The "who runs this site" paragraph. Empty means the hub is showing the
   * shared default, which `who_runs_this_default` carries so the form can
   * offer it as a placeholder rather than as a value the admin must keep.
   */
  who_runs_this: string;
  who_runs_this_default: string;
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
    operator_name: await getOperatorName(hubId),
    contact_email: await getContactEmail(hubId),
    hostname: currentHub()?.hostname ?? "",
    who_runs_this: await getWhoRunsThis(hubId),
    who_runs_this_default: whoRunsThisDefault(currentHub()),
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
      operator_name?: unknown;
      contact_email?: unknown;
      who_runs_this?: unknown;
      brief_recipient_emails?: unknown;
      officials?: unknown;
      announcement_authors?: unknown;
      beta_allowlist?: unknown;
      support_threshold?: unknown;
      comment_identity_mode?: unknown;
    };

    if (body.operator_name !== undefined) {
      if (typeof body.operator_name !== "string") {
        res.status(400).json({ error: "operator_name must be a string." });
        return;
      }
      await setOperatorName(currentHubId(), body.operator_name, actor);
    }

    if (body.contact_email !== undefined) {
      if (typeof body.contact_email !== "string") {
        res.status(400).json({ error: "contact_email must be a string." });
        return;
      }
      // Shape-checked, not verified. A hub that types its address wrong gets
      // a wrong address on its terms page either way; what this catches is a
      // value that is not an address at all, which would render as prose in
      // the middle of a legal document.
      const cleaned = body.contact_email.trim();
      if (cleaned !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
        res.status(400).json({
          error: `"${cleaned}" is not an email address. The legal pages print this verbatim.`,
        });
        return;
      }
      await setContactEmail(currentHubId(), cleaned, actor);
    }

    if (body.who_runs_this !== undefined) {
      if (typeof body.who_runs_this !== "string") {
        res.status(400).json({ error: "who_runs_this must be a string." });
        return;
      }
      // An empty string is meaningful: it clears the row and returns the hub
      // to the shared default. So it is stored as written, not rejected.
      await setWhoRunsThis(currentHubId(), body.who_runs_this, actor);
    }

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
