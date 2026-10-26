// civic.vote: an advisory vote (manifest: ./manifest.ts).
// Its pages, its two feed cards and the vote plugin's panel on the Plugins page.

import { NewVote, Process, VoteLog, Votes } from "../../ui/src/lazyPages";
import hub from "../../ui/src/config/hub";
import { voteResultLine } from "../../src/shared/feedActivity";
import { getProcessState, type VoteState } from "../../ui/src/services/api";
import { ChoiceField, NumberField, ParticipationValues } from "../../ui/src/pages/settings/pluginFields";
import { formatCount } from "../../ui/src/processes/feedText";
import type { FeedKindUi, ProcessMeta, ProcessUi } from "../../ui/src/processes/types";

const voteMeta = (id: string): Promise<ProcessMeta | null> =>
  getProcessState(id).then((state) => {
    if (state.type !== "civic.vote") return null;
    const vote = state as VoteState;
    return {
      title: vote.title,
      description: vote.description,
      // Null while results are hidden: unknown, not zero (review R26).
      totalVotes: vote.total_votes ?? undefined,
    };
  });

const voteOpen: FeedKindUi = {
  card: ({ id, getTitle, descSummary }) => ({ title: getTitle(id) ?? "Untitled vote", summary: descSummary }),
  meta: voteMeta,
  titleNeedsMeta: true,
  engagement: (meta) => {
    if (meta.totalVotes === undefined) return "Open for input";
    const n = meta.totalVotes;
    if (n === 0) return "Open for input — be the first to vote";
    const noun = `${hub.noun(n)} ${n === 1 ? "has" : "have"}`;
    return `${formatCount(n)} ${noun} voted so far`;
  },
};

const voteClosed: FeedKindUi = {
  card: ({ id, data, getTitle }) => {
    // The vote's own results, posted when it closes. The count of voters
    // is on the engagement line; the summary is the final count.
    const line = voteResultLine(data);
    return {
      title: getTitle(id) ?? "Vote results",
      summary: line ? `Voting has closed. Final count: ${line}.` : "Voting has closed. No votes were cast.",
    };
  },
  meta: voteMeta,
  titleNeedsMeta: true,
  engagement: (meta) => {
    const n = meta.totalVotes ?? 0;
    if (n === 0) return null;
    return `${formatCount(n)} ${hub.noun(n)} voted`;
  },
};

const voteUi: ProcessUi = {
  type: "civic.vote",
  routes: [
    { path: "/votes", element: <Votes /> },
    // The generic page: it hands every other type to its own page, so it checks
    // the record's plugin itself (pages/Process.tsx).
    { path: "/process/:id", element: <Process />, ungated: true },
    { path: "/votes/new", element: <NewVote /> },
    { path: "/votes/:id/log", element: <VoteLog /> },
  ],
  feed: {
    "vote-open": voteOpen,
    "vote-closed": voteClosed,
  },
  linkRelation: "continues",
  settingsPanel: (f) => (
    <>
      <p className="form-hint">
        How long a resident may keep a vote open. The person drafting a vote
        picks a length within this range; a new draft starts at the default.
        Leave a box empty to keep today's value.
      </p>
      <NumberField f={f} k="plugin.vote.min_duration_days" label="Shortest voting window" unit="days" placeholder="14" />
      <NumberField f={f} k="plugin.vote.max_duration_days" label="Longest voting window" unit="days" placeholder="90" />
      <NumberField f={f} k="plugin.vote.default_duration_days" label="Default voting window" unit="days" placeholder="42" />
      <ChoiceField
        f={f}
        k="plugin.vote.default_check_mode"
        label="Receipt check, for new votes"
        hint="After a vote closes, anyone with a receipt code can check it. The person drafting a vote can choose the other; it is fixed once the vote is approved."
        labels={{
          show_choice: "Show the choice: a code shows how that ballot was cast",
          counted_only: "Counted only: a code shows only that the ballot was counted",
        }}
        emptyLabel="Show the choice (the default)"
      />
      <ParticipationValues show="threshold" />
      <ParticipationValues show="anonymity" />
    </>
  ),
};

export default voteUi;
