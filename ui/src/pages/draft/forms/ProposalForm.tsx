import { useCallback } from "react";
import DraftingForm from "../../../components/DraftingForm";
import type { ProposalDraft } from "../../../services/api";
import type { DraftFormProps } from "../types";

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
