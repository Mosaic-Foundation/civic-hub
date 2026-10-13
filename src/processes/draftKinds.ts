// The four drafting kinds, each declared once (Audit 3, F1): what its draft
// stores (a DraftSpec for the generic store, src/modules/civic.drafts/) and
// what submitting it creates. The routes, the controller, the claim against
// a double submit and the Code of Conduct gate are shared
// (src/controllers/draftController.ts, src/routes/draftRoutes.ts). A new
// drafting type declares a DraftKind here and mounts draftRouter(kind).

import { overlongOption, VOTE_OPTION_MAX } from "../shared/voteOptions.js";
import { ValidationError } from "../errors/index.js";
import type { DraftSpec, Draft, BaseDraft } from "../modules/civic.drafts/index.js";
import { voteDurationLimitsSync, getSupportThreshold } from "../services/hubSettings.js";
import { supportPhaseConfig } from "../modules/civic.vote/index.js";
import { currentHubId } from "../config/hubContext.js";
import { sourceLineToContentLink } from "../shared/sourceLine.js";
import { assertPassesWordlist } from "../shared/wordlist/index.js";
import { parseSeedStatements } from "../shared/seedStatements.js";
import type { ProposedLink } from "../modules/civic.drafts/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What submitting a draft creates (or, on a revision, rewrites). */
export interface DraftSubmission {
  title: string;
  description: string;
  content?: Record<string, unknown>;
  state?: Record<string, unknown>;
  /** What a revision writes instead, where it differs from a new submission. */
  revise?: { content?: Record<string, unknown>; state?: Record<string, unknown> };
}

export interface DraftKind<D extends BaseDraft = BaseDraft> {
  spec: DraftSpec;
  /** For log lines: "[<tag>-submit] …". */
  tag: string;
  /** Checks a POST body's fields and returns the create input; throws to refuse (400). */
  createInput?(body: Record<string, unknown>): Record<string, unknown>;
  /** Why this draft cannot be submitted yet (a required field), or null. */
  missing(draft: D): string | null;
  /** The process a submission creates; throws to refuse (400). */
  build(draft: D): Promise<DraftSubmission> | DraftSubmission;
  /**
   * A live edit (a project's "Edit project"): the draft is applied to the
   * process in place, with no review, so the Code of Conduct check must have
   * passed. Returns the response body.
   */
  applyLiveEdit?(
    draft: D,
    processId: string,
    editor: { id: string; email: string },
    submission: DraftSubmission,
  ): Promise<Record<string, unknown>>;
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// --- Proposals ---------------------------------------------------------------

const VALID_CATEGORIES = new Set(["issue", "idea", "project", "concern"]);
/** The proposal_drafts.proposal_duration_ms column default (6 weeks). */
const DEFAULT_PROPOSAL_DURATION_MS = 42 * DAY_MS;

export type ProposalDraft = Draft<{
  category: string | null;
  considerations: string;
  proposal_duration_ms: number;
  steward_approved: boolean | null;
}>;

export const proposalDraftKind: DraftKind<ProposalDraft> = {
  tag: "proposal",
  spec: {
    processType: "civic.proposal",
    table: "proposal_drafts",
    idPrefix: "pdraft",
    fields: {
      category: {
        write: (v) => {
          if (v && !VALID_CATEGORIES.has(String(v))) throw new ValidationError("Invalid category");
          return v;
        },
      },
      considerations: { read: (v) => (v as string | null) ?? "", write: (v) => v, checked: true },
      proposal_duration_ms: {
        write: (v) => {
          const dur = Number(v);
          // 2 weeks to 3 months: the 6-month option was retired 2026-08-28
          // when every duration-bearing type adopted the same picker.
          if (isNaN(dur) || dur < 14 * DAY_MS || dur > 90 * DAY_MS) {
            throw new ValidationError("Duration must be between 2 weeks and 3 months");
          }
          return dur;
        },
      },
      steward_approved: {},
    },
    createDefaults: (input) => ({ category: input.category ?? null }),
    generatedFields: ["considerations"],
  },
  createInput(body) {
    const category = body.category;
    if (category && !VALID_CATEGORIES.has(String(category))) {
      throw new ValidationError("Invalid category. Must be: issue, idea, or project");
    }
    return { category };
  },
  missing: (d) => (d.title.trim() ? null : "Title is required"),
  build(d) {
    let description = d.description.trim();
    if (d.considerations.trim()) {
      description = description
        ? `${description}\n\nConsiderations:\n${d.considerations.trim()}`
        : `Considerations:\n${d.considerations.trim()}`;
    }
    // A missing or NaN duration would make the closing date an Invalid Date
    // and crash toISOString(); fall back to the column default.
    const candidate = Number(d.proposal_duration_ms);
    return {
      title: d.title.trim(),
      description: description || "",
      content: {
        optional_links: lines(d.sources),
        category: d.category ?? null,
        assistant_helped: d.assistant_helped,
        proposal_duration_ms: Number.isFinite(candidate) && candidate > 0 ? candidate : DEFAULT_PROPOSAL_DURATION_MS,
      },
    };
  },
};

// --- Votes -------------------------------------------------------------------

const VOTE_METHODS = ["yes_no_unsure", "approval"];

export type VoteDraft = Draft<{
  voting_duration_ms: number;
  method: string;
  custom_options: string[] | null;
}>;

export const voteDraftKind: DraftKind<VoteDraft> = {
  tag: "vote",
  spec: {
    processType: "civic.vote",
    table: "vote_drafts",
    idPrefix: "vdraft",
    fields: {
      voting_duration_ms: {
        read: (v) => Number(v),
        // The allowed range is per hub: plugin.vote.{min,max}_duration_days.
        write: (v) => {
          const ms = Number(v);
          const { minDays, maxDays } = voteDurationLimitsSync();
          if (!(ms >= minDays * DAY_MS && ms <= maxDays * DAY_MS)) {
            throw new ValidationError(
              `voting_duration_ms must be between ${minDays * DAY_MS} (${minDays} days) and ${maxDays * DAY_MS} (${maxDays} days)`,
            );
          }
          return ms;
        },
      },
      method: {
        read: (v) => (v as string | null) ?? "yes_no_unsure",
        write: (v) => {
          if (!VOTE_METHODS.includes(String(v))) throw new ValidationError(`method must be one of: ${VOTE_METHODS.join(", ")}`);
          return v;
        },
        checked: true,
      },
      custom_options: {
        read: (v) => (Array.isArray(v) ? (v as string[]) : null),
        write: (v) => {
          if (v !== null && (!Array.isArray(v) || v.length < 2)) {
            throw new ValidationError("custom_options must be an array with at least 2 items");
          }
          return v;
        },
        checked: true,
      },
    },
    createDefaults: () => ({ voting_duration_ms: voteDurationLimitsSync().defaultDays * DAY_MS }),
  },
  missing: (d) => (d.title.trim() ? null : "Title is required"),
  async build(d) {
    const method = d.method ?? "yes_no_unsure";
    // The hub's endorsement threshold is read here, once, and snapshotted onto
    // the vote, so a later change applies only to votes submitted after it. A
    // positive number makes this a proposed vote that opens at the threshold;
    // 0 skips the support phase. The same whoever submits.
    const state: Record<string, unknown> = {
      method,
      voting_duration_ms: d.voting_duration_ms,
      ...supportPhaseConfig(await getSupportThreshold(currentHubId())),
    };
    if (method === "approval" && Array.isArray(d.custom_options)) {
      const long = overlongOption(d.custom_options);
      if (long) throw new ValidationError(`Each option can be at most ${VOTE_OPTION_MAX} characters. Shorten "${long.slice(0, 40)}…".`, "option_too_long");
      state.options = d.custom_options;
    }
    const sources = lines(d.sources);
    // Parsed, not the raw line on both fields: storing the whole
    // "Title: https://…" line as the url made the href a relative path.
    const content = sources.length > 0 ? { links: sources.map(sourceLineToContentLink) } : undefined;
    return {
      title: d.title.trim(),
      description: d.description.trim() || "",
      content,
      state,
      revise: { content: content ?? {}, state },
    };
  },
};

// --- Projects ----------------------------------------------------------------

export type ProjectDraft = Draft<{
  banner_image_url: string | null;
  banner_image_alt: string | null;
}>;

export const projectDraftKind: DraftKind<ProjectDraft> = {
  tag: "project",
  spec: {
    processType: "civic.project",
    table: "project_drafts",
    // Was "pdraft", shared with proposals (audit F1). Rows made before keep theirs.
    idPrefix: "prjdraft",
    fields: {
      banner_image_url: { read: (v) => (v as string | null) ?? null, write: (v) => v },
      banner_image_alt: { read: (v) => (v as string | null) ?? null, write: (v) => v },
    },
  },
  missing: (d) => (d.title.trim() ? null : "Title is required"),
  build: (d) => ({
    title: d.title.trim(),
    description: d.description.trim(),
    content: {
      sources: lines(d.sources),
      assistant_helped: d.assistant_helped,
      banner_image_url: d.banner_image_url ?? null,
      banner_image_alt: d.banner_image_alt ?? null,
    },
  }),
  // Edit of a LIVE project (creator or admin, from "Edit project"): diff
  // against the process, apply in place, record the change, notify supporters.
  async applyLiveEdit(d, processId, editor, sub) {
    // Imported here, not at the top: the process handlers import this file
    // while the registry loads, and processEdits imports the process service.
    const { applyEdit } = await import("../services/processEdits.js");
    const changes = await applyEdit(processId, editor, {
      title: sub.title,
      description: sub.description,
      content: sub.content ?? {},
      links: d.links as ProposedLink[],
    });
    return {
      process_id: processId,
      edited: true,
      changed_fields: changes.changed_fields,
      formatting_only_fields: changes.formatting_only_fields,
    };
  },
};

// --- Conversations (Polis deliberations) -----------------------------------------

/** 6 weeks — the unified default duration across drafting types. */
export const DEFAULT_DELIBERATION_DURATION_MS = 42 * DAY_MS;

/**
 * A conversation draft. Field mapping onto the generic drafting vocabulary:
 * title is the conversation TOPIC, description the FRAMING shown to
 * participants; sources are "learn more" links under the framing.
 */
export type DeliberationDraft = Draft<{
  seed_statements: string;
  duration_ms: number;
  participation_threshold: number | null;
}>;

export const deliberationDraftKind: DraftKind<DeliberationDraft> = {
  tag: "deliberation",
  spec: {
    processType: "civic.polis_deliberation",
    table: "deliberation_drafts",
    idPrefix: "ddraft",
    fields: {
      seed_statements: { read: (v) => (v as string | null) ?? "", write: (v) => v, checked: true },
      duration_ms: {
        read: (v) => Number(v),
        // 2 weeks to 3 months, as for votes.
        write: (v) => {
          const ms = Number(v);
          if (ms < 14 * DAY_MS || ms > 90 * DAY_MS) {
            throw new ValidationError(`duration_ms must be between ${14 * DAY_MS} (2 weeks) and ${90 * DAY_MS} (3 months)`);
          }
          return ms;
        },
      },
      participation_threshold: {
        read: (v) => (v === null || v === undefined ? null : Number(v)),
        write: (v) => {
          if (v !== null && (!Number.isInteger(v) || (v as number) < 1)) {
            throw new ValidationError("participation_threshold must be a positive integer or null");
          }
          return v;
        },
      },
    },
    generatedFields: ["seed_statements"],
  },
  missing: (d) => (!d.title.trim() ? "Topic is required" : !d.description.trim() ? "Framing is required" : null),
  build(d) {
    const seeds = parseSeedStatements(d.seed_statements);
    // Seed statements are posted to Polis as statements, so they pass the
    // same word list every participant's statement does — at submission, so
    // the creator is told which line to fix (Adam, 2026-09-06).
    for (const seed of seeds) assertPassesWordlist(seed);
    // A "learn more" list, not a bibliography: at most 6.
    const sources = lines(d.sources).slice(0, 6);
    // duration_ms (not a deadline) goes on state: the deadline is computed
    // when the conversation STARTS, so review time never eats into it.
    const state: Record<string, unknown> = {
      topic: d.title.trim(),
      framing: d.description.trim(),
      duration_ms: d.duration_ms,
      assistant_helped: d.assistant_helped,
      ...(d.participation_threshold ? { participation_threshold: d.participation_threshold } : {}),
      ...(seeds.length > 0 ? { seed_statements: seeds } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    };
    return { title: d.title.trim(), description: d.description.trim(), state };
  },
};
