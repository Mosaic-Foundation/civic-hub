import { useCallback } from "react";
import type { DraftFormProps } from "@civic-social/plugin-sdk/ui";
import DeliberationDraftingForm from "./DeliberationDraftingForm";
import type { DeliberationDraft } from "./api";

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
      onSubmit={onSubmit}
      disabled={disabled}
      fieldGuidance={flow.config?.field_guidance}
      onGetSuggestions={flow.shellAssistant?.onSuggest}
      suggesting={flow.shellAssistant?.suggesting}
    />
  );
}
