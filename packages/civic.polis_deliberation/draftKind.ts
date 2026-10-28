// What a conversation draft stores and what submitting it creates (a
// DraftKind: the routes, the controller, the claim against a double submit and
// the Code of Conduct gate are the hub's, src/controllers/draftController.ts).

import { DAY_MS, lines, ValidationError, type Draft, type DraftKind } from "@civic-social/plugin-sdk/first-party";
import { assertPassesWordlist } from "../../src/shared/wordlist/index.js";
import { parseSeedStatements } from "../../src/shared/seedStatements.js";

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
