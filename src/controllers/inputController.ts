// Input controller — handles HTTP request/response for community input endpoints

import { Request, Response } from "express";
import {
  submitInput,
  getInputsByProcess,
  type CommunityInput,
  type CommentPhase,
} from "../modules/civic.input/index.js";
import { getProcess } from "../services/processService.js";
import { getProcessHandler } from "../processes/registry.js";
import { getDb } from "../db/client.js";
import {
  getAuthUser,
  isAdminEmail,
  resolveCallerUser,
} from "../middleware/auth.js";
import { emitEvent } from "../events/eventEmitter.js";
import { getCommentIdentityMode } from "../services/hubSettings.js";
import {
  resolveCreators,
  redactForAudience,
} from "../services/creatorDisplay.js";
import { buildProcessAnonNumbers } from "../services/processAnonymity.js";
import { HUB_ID } from "../config/hub.js";


async function proposalExists(id: string): Promise<boolean> {
  const { data } = await getDb()
    .from("proposals")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return !!data;
}

async function getSourceProposalId(processId: string): Promise<string | null> {
  const { data } = await getDb()
    .from("processes")
    .select("source_proposal_id")
    .eq("id", processId)
    .maybeSingle();
  return (data as { source_proposal_id: string | null } | null)
    ?.source_proposal_id ?? null;
}

/**
 * Redact a comment for non-admin viewers.
 *   - author_id is ALWAYS stripped — residents identify each other by
 *     author_name (or "Anonymous"), never by user id.
 *   - Hidden comments (Slice 11) additionally lose their body, and
 *     `moderation.reason` is dropped — the reason is internal-audit
 *     only.
 * Admins receive the row unchanged.
 */
function redactForPublic(input: CommunityInput): CommunityInput {
  const publicInput: CommunityInput = { ...input, author_id: "" };
  if (!publicInput.moderation?.hidden) return publicInput;
  return {
    ...publicInput,
    body: "",
    moderation: {
      ...publicInput.moderation,
      reason: null,
    },
  };
}

export async function handleSubmitInput(
  req: Request,
  res: Response,
): Promise<void> {
  const processId = req.params.id as string;
  const { body, is_anonymous } = req.body as {
    body?: unknown;
    is_anonymous?: unknown;
  };

  if (!body) {
    res.status(400).json({ error: "Missing required field: body" });
    return;
  }

  try {
    const process = await getProcess(processId);
    let hubId: string;
    let jurisdiction: string;
    let phase: CommentPhase;

    if (process) {
      hubId = process.hubId;
      jurisdiction = process.jurisdiction;
      // "vote" keeps its meaning (the panel draws a divider between a
      // vote's comments and the ones carried over from its proposal);
      // every other type's comment is just a comment.
      phase = process.definition.type === "civic.vote" ? "vote" : "comment";
    } else if (await proposalExists(processId)) {
      hubId = HUB_ID;
      jurisdiction = "local";
      phase = "proposal";
    } else {
      res.status(404).json({ error: "Process not found" });
      return;
    }

    const user = getAuthUser(res);

    // A creator's update: the one phase a client may ask for, and only the
    // process's creator may post it. Same storage and moderation as a
    // comment; the type's handler adds whatever an update means to it.
    const requestedPhase = req.body?.phase;
    const isUpdate = requestedPhase === "update";
    if (requestedPhase !== undefined && !isUpdate) {
      res.status(400).json({ error: "Unknown phase." });
      return;
    }
    if (isUpdate) {
      if (!process || process.createdBy !== user.id) {
        res.status(403).json({ error: "Only the creator can post an update." });
        return;
      }
      phase = "update";
    }

    // Hub-wide identity policy for comments. The mode overrides the
    // caller's flag in both directions so a stale client can't bypass
    // the admin's setting.
    const mode = await getCommentIdentityMode();
    let isAnonymous = is_anonymous === true;
    if (mode === "real_name") isAnonymous = false;
    if (mode === "anonymous_only") isAnonymous = true;
    if (isUpdate) isAnonymous = false; // an update is signed by the creator

    const input = await submitInput(processId, user.id, String(body), {
      hub_id: hubId,
      jurisdiction,
      emit: emitEvent,
    }, phase, {
      is_anonymous: isAnonymous,
      // Real-name snapshot at post time (required-name policy makes
      // full_name present for all participants; display_name covers
      // legacy Board accounts).
      author_name: user.full_name ?? user.display_name ?? null,
    });
    if (isUpdate && process) {
      await getProcessHandler(process.definition.type)?.onUpdatePosted?.(process, {
        id: input.id,
        actor: user.id,
      });
    }
    res.status(201).json(redactForPublic(input));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

/**
 * GET /input/identity-mode — public. The comment composers read this
 * to decide whether to render the "post anonymously" toggle (or force
 * anonymity) per the admin-configured hub policy.
 */
export async function handleGetCommentIdentityMode(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const mode = await getCommentIdentityMode();
    res.json({ mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function handleGetInputs(
  req: Request,
  res: Response,
): Promise<void> {
  const processId = req.params.id as string;
  try {
    const process = await getProcess(processId);
    if (!process && !(await proposalExists(processId))) {
      res.status(404).json({ error: "Process not found" });
      return;
    }

    let inputs = await getInputsByProcess(processId);

    // If this is a vote that was converted from a proposal, merge in
    // the proposal-phase comments so they carry forward.
    if (process) {
      const sourceProposalId = await getSourceProposalId(processId);
      if (sourceProposalId) {
        const proposalInputs = await getInputsByProcess(sourceProposalId);
        inputs = [...inputs, ...proposalInputs];
      }
    }

    // Resolve author admin-status and office in ONE query, for
    // non-anonymous comments only. Anonymity is never pierced — anonymous
    // comments stay author_is_admin=false with no office regardless of
    // who posted them.
    const authorIds = inputs
      .filter((c) => !c.is_anonymous)
      .map((c) => c.author_id)
      .filter((id) => id.length > 0);
    const creatorMap = await resolveCreators(authorIds);

    // One token resolution decides both tiers below: admins see raw
    // author ids + moderation detail; a valid session of any kind is a
    // MEMBER (real names, today's behavior); no valid session is the
    // PUBLIC, whose resident bylines are anonymized to "Resident N" —
    // numbered per-process from the same map the page's author byline
    // uses, so the thread and the byline agree.
    const caller = await resolveCallerUser(req);
    const isAdmin = !!caller && isAdminEmail(caller.email);
    const anonNumbers = caller
      ? undefined
      : await buildProcessAnonNumbers(processId);

    const withAdmin = inputs.map((c) => {
      const resolved = c.is_anonymous ? undefined : creatorMap.get(c.author_id);
      if (!c.is_anonymous && !caller) {
        // Public audience. An OFFICIAL author keeps their real name and
        // office; any other resident's post-time name snapshot is
        // overridden — a snapshot is still a real name.
        const shown = redactForAudience(
          resolved ?? { name: "Resident", is_admin: false, official: null },
          c.author_id,
          { audience: "public", anonNumbers },
        );
        return {
          ...c,
          author_name: shown.name,
          author_is_admin: shown.is_admin,
          author_official_type: shown.official?.type ?? null,
          author_official_title: shown.official?.title ?? null,
        };
      }
      return {
        ...c,
        // Display name: the post-time snapshot wins (so later name edits don't
        // rewrite history), but legacy comments predate the snapshot and stored
        // null — fall back to the live-resolved name so they show the real
        // person, not "Resident". Anonymous comments keep null ("Anonymous").
        author_name: c.is_anonymous
          ? c.author_name
          : c.author_name ?? resolved?.name ?? null,
        author_is_admin: !c.is_anonymous && (resolved?.is_admin ?? false),
        // Same anonymity rule as author_is_admin: an anonymous comment
        // never carries its author's office, which would identify them
        // as surely as their name would.
        author_official_type: c.is_anonymous
          ? null
          : (resolved?.official?.type ?? null),
        author_official_title: c.is_anonymous
          ? null
          : (resolved?.official?.title ?? null),
      };
    });

    res.json(isAdmin ? withAdmin : withAdmin.map(redactForPublic));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
