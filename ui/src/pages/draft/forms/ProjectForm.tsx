import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProjectDraftingForm from "../../../components/ProjectDraftingForm";
import { getProjectDetail, type ProjectDraft } from "../../../services/api";
import { type DraftFormProps } from "../types";

export default function ProjectForm({ draft, flow, ctx, links, onLinksChange, linkTitles, onLinkTitlesChange, onSubmit, disabled }: DraftFormProps<ProjectDraft>) {
  const { queuePatch } = flow;
  const navigate = useNavigate();
  const editProcessId = ctx.editProcessId;
  const lockedParam = ctx.searchParams.get("locked");
  const lockedFields = (lockedParam ?? "").split(",").filter(Boolean);
  const [lockedValues, setLockedValues] = useState<{ title?: string } | undefined>(undefined);
  useEffect(() => {
    if (!editProcessId || lockedFields.length === 0) return;
    let cancelled = false;
    getProjectDetail(editProcessId)
      .then((p) => { if (!cancelled) setLockedValues({ title: p.title }); })
      .catch(() => { /* the input falls back to the draft's title */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editProcessId, lockedParam]);

  const onFieldChange = useCallback((field: string, value: string) => void queuePatch({ [field]: value }), [queuePatch]);
  const onImageChange = useCallback(
    (next: { image_url: string | null; image_alt: string | null }) =>
      void queuePatch({ banner_image_url: next.image_url, banner_image_alt: next.image_alt }),
    [queuePatch],
  );
  return (
    <ProjectDraftingForm
      draft={draft}
      links={links}
      onLinksChange={onLinksChange}
      linkSelfId={editProcessId ?? undefined}
      linkTitles={linkTitles}
      onLinkTitlesChange={onLinkTitlesChange}
      onFieldChange={onFieldChange}
      onImageChange={onImageChange}
      onReview={flow.handleReview}
      onSubmit={onSubmit}
      lockedFields={lockedFields}
      lockedValues={lockedValues}
      onCancel={editProcessId ? () => navigate(`/project/${editProcessId}`) : undefined}
      submitLabel={editProcessId ? "Submit edits" : undefined}
      disabled={disabled}
      reviewLoading={flow.reviewing}
      fieldGuidance={flow.config?.field_guidance}
      onGetSuggestions={editProcessId ? undefined : flow.shellAssistant?.onSuggest}
      suggesting={flow.shellAssistant?.suggesting}
    />
  );
}
