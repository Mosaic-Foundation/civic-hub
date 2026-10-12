import { useCallback } from "react";
import DeliberationDraftingForm from "../../../components/DeliberationDraftingForm";
import type { DeliberationDraft } from "../../../services/api";
import type { DraftFormProps } from "../types";

export default function ConversationForm({ draft, flow, links, onLinksChange, linkTitles, onLinkTitlesChange, onSubmit, disabled }: DraftFormProps<DeliberationDraft>) {
  const { queuePatch } = flow;
  const onFieldChange = useCallback((field: string, value: string) => void queuePatch({ [field]: value }), [queuePatch]);
  const onDurationChange = useCallback((ms: number) => void queuePatch({ duration_ms: ms }), [queuePatch]);
  // Not a content change: the server leaves the check standing.
  const onThresholdChange = useCallback((n: number | null) => void queuePatch({ participation_threshold: n }), [queuePatch]);
  return (
    <DeliberationDraftingForm
      draft={draft}
      links={links}
      onLinksChange={onLinksChange}
      linkTitles={linkTitles}
      onLinkTitlesChange={onLinkTitlesChange}
      onFieldChange={onFieldChange}
      onDurationChange={onDurationChange}
      onThresholdChange={onThresholdChange}
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
