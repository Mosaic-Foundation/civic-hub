// One controller for every drafting kind (Audit 3, F1): create, list, read,
// edit and submit, given a DraftKind (src/processes/draftKinds.ts). Before
// this, each kind had its own copy, and only proposals claimed a draft before
// creating anything, so a double click or two tabs could put the same draft
// in the review queue twice.
//
// Assistant conversation and the Code of Conduct check live on the shared
// /assistant routes (assistantController), dispatched through the registry.
// This controller owns draft storage and submission.

import type { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  claimDraftForSubmission,
  createDraft,
  getDraft,
  listUserDrafts,
  setDraftStatus,
  updateDraft,
  type BaseDraft,
} from "../modules/civic.drafts/index.js";
import { submitAsCreator, reviseAndResubmit } from "../modules/civic.review/index.js";
import { codeOfConductStanding } from "../services/codeOfConduct.js";
import { validateLinkSet } from "../modules/civic.process_links/index.js";
import { personFallbackName } from "../services/creatorDisplay.js";
import { HubDbError } from "../db/forHub.js";
import type { DraftKind } from "../processes/draftKinds.js";

const message = (err: unknown) => (err instanceof Error ? err.message : "Unknown error");

export interface DraftHandlers {
  create(req: Request, res: Response): Promise<void>;
  list(req: Request, res: Response): Promise<void>;
  get(req: Request, res: Response): Promise<void>;
  update(req: Request, res: Response): Promise<void>;
  submit(req: Request, res: Response): Promise<void>;
}

export function draftController<D extends BaseDraft>(kind: DraftKind<D>): DraftHandlers {
  const { spec } = kind;

  /** The caller's own draft, or the response that says why not (and undefined). */
  async function ownDraft(req: Request, res: Response, forbidden: string): Promise<D | undefined> {
    const user = getAuthUser(res);
    const draft = await getDraft<D>(spec, req.params.id as string);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return undefined;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: forbidden });
      return undefined;
    }
    return draft as D;
  }

  return {
    async create(req, res) {
      const user = getAuthUser(res);
      try {
        const input = kind.createInput ? kind.createInput(req.body ?? {}) : {};
        res.status(201).json(await createDraft(spec, user.id, input));
      } catch (err) {
        res.status(400).json({ error: message(err) });
      }
    },

    async list(_req, res) {
      const user = getAuthUser(res);
      try {
        res.json(await listUserDrafts(spec, user.id, "drafting"));
      } catch (err) {
        res.status(500).json({ error: message(err) });
      }
    },

    async get(req, res) {
      try {
        const draft = await ownDraft(req, res, "Not authorized to view this draft");
        if (draft) res.json(draft);
      } catch (err) {
        res.status(500).json({ error: message(err) });
      }
    },

    async update(req, res) {
      try {
        const draft = await ownDraft(req, res, "Not authorized");
        if (!draft) return;
        if (draft.status !== "drafting") {
          res.status(400).json({ error: "Cannot edit a submitted draft" });
          return;
        }
        const { links, assistant_applied, ...fields } = (req.body ?? {}) as Record<string, unknown>;
        const updated = await updateDraft(spec, draft.id, {
          ...fields,
          // Links are validated against the DRAFT id purely to reuse the
          // self-link and vocabulary checks; the real from_id is the process
          // created at submission.
          links: links === undefined ? undefined : validateLinkSet("", links),
          assistant_applied: assistant_applied === true,
        });
        res.json(updated);
      } catch (err) {
        res.status(400).json({ error: message(err) });
      }
    },

    async submit(req, res) {
      const user = getAuthUser(res);
      try {
        const draft = await ownDraft(req, res, "Not authorized");
        if (!draft) return;
        if (draft.status !== "drafting") {
          res.status(400).json({ error: "Draft already submitted" });
          return;
        }
        const missing = kind.missing(draft);
        if (missing) {
          res.status(400).json({ error: missing });
          return;
        }

        // The Code of Conduct check must have run on exactly this text
        // (services/codeOfConduct.ts); the client cannot say it did.
        const coc = await codeOfConductStanding(spec.processType, draft);
        if (coc.refusal) {
          res.status(400).json({ error: coc.refusal });
          return;
        }

        const submission = await kind.build(draft);
        const editProcessId = typeof req.body?.edit_process_id === "string" ? req.body.edit_process_id : undefined;
        const reviewId = typeof req.body?.review_id === "string" ? req.body.review_id : undefined;

        // A live edit has no reviewer, so the check must have PASSED on this
        // text: an unavailable check, which lets a new submission through to
        // an admin, does not let an edit go live.
        if (editProcessId && kind.applyLiveEdit && !coc.passed) {
          res.status(400).json({
            error: "The Code of Conduct check couldn't run, so these edits can't go live yet. Run the check again in a moment.",
          });
          return;
        }

        // Claim the draft BEFORE creating anything: a concurrent or repeated
        // submit (a double click, two tabs) finds it claimed and creates
        // nothing. If the work fails, the claim is released so the person can
        // try again.
        if (!(await claimDraftForSubmission(spec, draft.id))) {
          res.status(409).json({ error: "Draft has already been submitted" });
          return;
        }

        try {
          if (editProcessId && kind.applyLiveEdit) {
            res.status(200).json(await kind.applyLiveEdit(draft, editProcessId, { id: user.id, email: user.email }, submission));
            return;
          }

          // Revision of an existing submission (an admin asked for changes):
          // update the process in place and put it back in the queue, never a
          // second one.
          if (reviewId) {
            const review = await reviseAndResubmit(reviewId, user.id, {
              title: submission.title,
              description: submission.description,
              content: submission.revise ? submission.revise.content : submission.content,
              state: submission.revise ? submission.revise.state : submission.state,
              links: draft.links,
            });
            res.status(201).json({ review_id: review.id, process_id: review.process_id, auto_approved: false });
            return;
          }

          // One creation path: always submit for review; admins (and, on a
          // demo hub, a visitor whose check passed) are approved at once.
          const result = await submitAsCreator(
            {
              draft_id: draft.id,
              links: draft.links,
              process_type: spec.processType,
              title: submission.title,
              description: submission.description,
              creator_id: user.id,
              creator_name: user.full_name || user.display_name || personFallbackName(),
              creator_email: user.email,
              content: submission.content,
              state: submission.state,
            },
            user.email,
            { cocPassed: coc.passed },
          );
          res.status(201).json(result);
        } catch (workErr) {
          // The review queue already holds this draft
          // (process_reviews_one_per_draft): it stays submitted.
          if (workErr instanceof HubDbError && workErr.code === "23505") {
            res.status(409).json({ error: "Draft has already been submitted" });
            return;
          }
          // Nothing was created: release the draft for another try.
          await setDraftStatus(spec, draft.id, "drafting").catch(() => {});
          throw workErr;
        }
      } catch (err) {
        console.error(`[${kind.tag}-submit]`, message(err));
        res.status(400).json({ error: message(err) });
      }
    },
  };
}
