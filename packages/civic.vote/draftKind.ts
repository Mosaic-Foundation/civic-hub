// What a vote draft stores and what submitting it creates (a DraftKind: the
// routes, the controller, the claim against a double submit and the Code of
// Conduct gate are the hub's, src/controllers/draftController.ts).

import {
  ValidationError,
  currentHubId,
  voteDurationLimitsSync,
  getSupportThreshold,
  defaultCheckModeSync,
  lines,
  DAY_MS,
  type Draft,
  type DraftKind,
} from "../../src/sdk/index.js";
import { CHECK_MODES, isCheckMode, type CheckMode } from "../../src/shared/checkMode.js";
import { filledOptions, overlongOption, VOTE_OPTION_MAX } from "../../src/shared/voteOptions.js";
import { sourceLineToContentLink } from "../../src/shared/sourceLine.js";
import { supportPhaseConfig } from "./service.js";

const VOTE_METHODS = ["yes_no_unsure", "approval"];

export type VoteDraft = Draft<{
  voting_duration_ms: number;
  method: string;
  custom_options: string[] | null;
  check_mode: CheckMode | null;
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
      // How the receipt check answers after close (src/shared/checkMode.ts).
      check_mode: {
        read: (v) => (isCheckMode(v) ? v : null),
        write: (v) => {
          if (v !== null && !isCheckMode(v)) throw new ValidationError(`check_mode must be one of: ${CHECK_MODES.join(", ")}`);
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
    createDefaults: () => ({
      voting_duration_ms: voteDurationLimitsSync().defaultDays * DAY_MS,
      check_mode: defaultCheckModeSync(),
    }),
  },
  // Blank option fields don't count and never block Submit; two filled ones do.
  missing: (d) =>
    !d.title.trim()
      ? "Title is required"
      : d.method === "approval" && filledOptions(d.custom_options ?? []).length < 2
        ? "An approval vote needs at least two options."
        : null,
  async build(d) {
    const method = d.method ?? "yes_no_unsure";
    // The hub's endorsement threshold is read here, once, and snapshotted onto
    // the vote, so a later change applies only to votes submitted after it. A
    // positive number makes this a proposed vote that opens at the threshold;
    // 0 skips the support phase. The same whoever submits.
    const state: Record<string, unknown> = {
      method,
      voting_duration_ms: d.voting_duration_ms,
      // Fixed from approval on: the vote has no edit path once live.
      check_mode: d.check_mode ?? defaultCheckModeSync(),
      ...supportPhaseConfig(await getSupportThreshold(currentHubId())),
    };
    if (method === "approval" && Array.isArray(d.custom_options)) {
      const long = overlongOption(d.custom_options);
      if (long) throw new ValidationError(`Each option can be at most ${VOTE_OPTION_MAX} characters. Shorten "${long.slice(0, 40)}…".`, "option_too_long");
      state.options = filledOptions(d.custom_options);
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
