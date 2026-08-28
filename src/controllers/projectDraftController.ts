import { Request, Response } from "express";
import { getAuthUser } from "../middleware/auth.js";
import {
  createProjectDraft,
  getProjectDraft,
  listUserProjectDrafts,
  updateProjectDraft,
  setProjectDraftStatus,
} from "../modules/civic.project_drafts/index.js";
import { submitAsCreator } from "../modules/civic.review/index.js";
import { validateLinkSet } from "../modules/civic.process_links/index.js";

// Assistant conversation + Code of Conduct review live on the shared
// /assistant routes (assistantController), dispatched through the registry.
// This controller owns only draft storage and submission.

export async function handleCreateProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const draft = await createProjectDraft({ user_id: user.id });
    res.status(201).json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleListProjectDrafts(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);

  try {
    const drafts = await listUserProjectDrafts(user.id, "drafting");
    res.json(drafts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized to view this draft" });
      return;
    }
    res.json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleUpdateProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (draft.status !== "drafting") {
      res.status(400).json({ error: "Cannot edit a submitted draft" });
      return;
    }

    const { title, description, sources, banner_image_url, banner_image_alt, links, skip_modified_flag, assistant_applied } = req.body;

    const updated = await updateProjectDraft(id, {
      title,
      description,
      sources,
      banner_image_url,
      banner_image_alt,
      // Links are validated against the DRAFT id purely to reuse the
      // self-link/vocabulary checks; the real from_id is the process created
      // at submission. A draft can't link to itself in any meaningful sense.
      links: links === undefined ? undefined : validateLinkSet("", links),
      skip_modified_flag: skip_modified_flag === true,
      assistant_applied: assistant_applied === true,
    });
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function handleSubmitProjectDraft(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getAuthUser(res);
  const id = req.params.id as string;

  try {
    const draft = await getProjectDraft(id);
    if (!draft) {
      res.status(404).json({ error: "Draft not found" });
      return;
    }
    if (draft.user_id !== user.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (draft.status !== "drafting") {
      res.status(400).json({ error: "Draft already submitted" });
      return;
    }
    if (!draft.title.trim()) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    const hasHardBlocks = (draft.last_review_result ?? []).some(
      (s) => s.severity === "hard",
    );
    if (hasHardBlocks) {
      res.status(400).json({
        error: "Cannot submit: unresolved Code of Conduct concerns. Review your draft.",
      });
      return;
    }
    if (draft.draft_modified_since_review) {
      res.status(400).json({
        error: "Draft has been modified since last review. Please review again before submitting.",
      });
      return;
    }

    const sources = draft.sources
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // One creation path: always submit for review; admins are auto-approved.
    const result = await submitAsCreator(
      {
        links: draft.links,
        process_type: "civic.project",
        title: draft.title.trim(),
        description: draft.description.trim(),
        creator_id: user.id,
        creator_name: user.full_name || user.display_name || "Resident",
        creator_email: user.email,
        content: {
          sources,
          assistant_helped: draft.assistant_helped,
          banner_image_url: draft.banner_image_url ?? null,
          banner_image_alt: draft.banner_image_alt ?? null,
        },
      },
      user.email,
    );

    await setProjectDraftStatus(id, "submitted");
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[project-submit]", message);
    res.status(400).json({ error: message });
  }
}
