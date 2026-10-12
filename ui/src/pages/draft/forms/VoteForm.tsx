import { useCallback, useEffect, useState } from "react";
import VoteDraftingForm from "../../../components/VoteDraftingForm";
import { getVoteDurationLimits, type VoteDraft, type VoteDurationLimits } from "../../../services/api";
import { DAY_MS } from "../durations";
import type { DraftFormProps } from "../types";

export default function VoteForm({
  draft, saved, flow, links, onLinksChange, linkTitles, onLinkTitlesChange, onSubmit, disabled, kindState, setKindState,
}: DraftFormProps<VoteDraft>) {
  const { queuePatch } = flow;
  // The voting method decides which assistant fields exist (an approval vote
  // has an Options field; a yes/no vote does not). It lives in the page's
  // kindState so the field list is recomputed the moment the method changes,
  // and is synced from the draft once it loads. The map lives in
  // services/voteMethods.ts.
  const method = kindState.method;
  useEffect(() => {
    const m = saved?.method;
    if (m && m !== method) setKindState({ method: m });
  }, [saved?.method, method, setKindState]);

  // The hub's allowed voting windows. Until they load (or if they cannot),
  // the standard choices and the standard default apply.
  const [durationLimits, setDurationLimits] = useState<VoteDurationLimits | null>(null);
  useEffect(() => {
    getVoteDurationLimits().then(setDurationLimits).catch(() => setDurationLimits(null));
  }, []);

  const shown: VoteDraft =
    !saved && durationLimits && !("voting_duration_ms" in flow.pendingFields)
      ? { ...draft, voting_duration_ms: durationLimits.default_days * DAY_MS }
      : draft;

  const onFieldChange = useCallback((field: string, value: string) => void queuePatch({ [field]: value }), [queuePatch]);
  const onDurationChange = useCallback((ms: number) => void queuePatch({ voting_duration_ms: ms }), [queuePatch]);
  const onMethodChange = useCallback(
    (m: string, options: string[] | null) => {
      setKindState({ method: m }); // the field list follows immediately, not after the save
      void queuePatch({ method: m, custom_options: options });
    },
    [queuePatch, setKindState],
  );
  return (
    <VoteDraftingForm
      draft={shown}
      durationLimits={durationLimits}
      links={links}
      onLinksChange={onLinksChange}
      linkTitles={linkTitles}
      onLinkTitlesChange={onLinkTitlesChange}
      onFieldChange={onFieldChange}
      onDurationChange={onDurationChange}
      onMethodChange={onMethodChange}
      onReview={flow.handleReview}
      onSubmit={onSubmit}
      disabled={disabled}
      reviewLoading={flow.reviewing}
      reviewFailed={flow.reviewFailed}
      fieldGuidance={flow.config?.field_guidance}
      onGetSuggestions={flow.shellAssistant?.onSuggest}
      suggesting={flow.shellAssistant?.suggesting}
    />
  );
}
