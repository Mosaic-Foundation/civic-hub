// A closed conversation's summary from its own recorded result, for when
// nothing has written the result up (kernel step 1, Conversations 0.4.0): no
// package that writes results is on, or it has not finished yet. The page
// then shows the result's own figures (agreement, groups, participation) and
// says there is no written summary. Once a result is written up, the
// conversation keeps that summary (keepResult in ./boot.ts) and shows it.
//
// The same figures Briefs' summary carries without its write-up
// (packages/civic.brief/deliberation/summarize.ts, summaryWithoutNarrative);
// each package keeps its own copy, as packages never import each other.

import type { DeliberationResult, DeliberationSummary } from "@civic-social/plugin-sdk";

export function summaryFromResult(result: DeliberationResult, at: string): DeliberationSummary {
  return {
    summary_text: "",
    directed_questions: [],
    top_consensus_statements: result.consensus.agree.map((c) => ({
      statement_text: c.text,
      agree_rate: c.agree_rate,
      vote_count: c.vote_count,
    })),
    opinion_groups: result.groups.map((g) => ({
      group_id: g.id,
      size: g.size,
      representative_statements: g.representative_statements.map((rs) => ({
        text: rs.text,
        agreement_within_group: rs.repness,
      })),
    })),
    participation_stats: {
      total_participants: result.participant_count,
      total_statements: result.statement_count,
      total_votes: 0,
      opinion_groups_formed: result.groups.length,
    },
    linked_polis_data_uri: result.data_uri,
    methodology: { prompt_version: "none", model_used: "none", generated_at: at },
    narrative: "unwritten",
  };
}
