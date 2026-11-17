import { useCallback } from "react";
import {
  type DraftFormProps,
} from "@civic-social/plugin-sdk/ui";
import DraftingForm from "./DraftingForm";
import type { ProposalDraft } from "./api";

export default function ProposalForm({ draft, flow, links, onLinksChange, linkTitles, onLinkTitlesChange, onSubmit, disabled }: DraftFormProps<ProposalDraft>) {
  const { queuePatch } = flow;
  const onFieldChange = useCallback((field: string, value: string) => void queuePatch({ [field]: value }), [queuePatch]);
  const onDurationChange = useCallback((ms: number) => void queuePatch({ proposal_duration_ms: ms }), [queuePatch]);
  return (
    <DraftingForm
      draft={draft}
      links={links}
      onLinksChange={onLinksChange}
      linkTitles={linkTitles}
      onLinkTitlesChange={onLinkTitlesChange}
      onFieldChange={onFieldChange}
      onDurationChange={onDurationChange}
      onSubmit={onSubmit}
      disabled={disabled}
      fieldGuidance={flow.config?.field_guidance}
      onGetSuggestions={flow.shellAssistant?.onSuggest}
      suggesting={flow.shellAssistant?.suggesting}
    />
  );
}
