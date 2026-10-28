// What a project draft stores and what submitting it creates (a DraftKind:
// the routes, the controller, the claim against a double submit and the Code
// of Conduct gate are the hub's, src/controllers/draftController.ts).

import { applyEdit, lines, type Draft, type DraftKind, type ProposedLink } from "@civic-social/plugin-sdk/first-party";

export type ProjectDraft = Draft<{
  banner_image_url: string | null;
  banner_image_alt: string | null;
}>;

export const projectDraftKind: DraftKind<ProjectDraft> = {
  tag: "project",
  spec: {
    processType: "civic.project",
    table: "project_drafts",
    // Was "pdraft", shared with proposals (audit F1). Rows made before keep theirs.
    idPrefix: "prjdraft",
    fields: {
      banner_image_url: { read: (v) => (v as string | null) ?? null, write: (v) => v },
      banner_image_alt: { read: (v) => (v as string | null) ?? null, write: (v) => v },
    },
  },
  missing: (d) => (d.title.trim() ? null : "Title is required"),
  build: (d) => ({
    title: d.title.trim(),
    description: d.description.trim(),
    content: {
      sources: lines(d.sources),
      assistant_helped: d.assistant_helped,
      banner_image_url: d.banner_image_url ?? null,
      banner_image_alt: d.banner_image_alt ?? null,
    },
  }),
  // Edit of a LIVE project (creator or admin, from "Edit project"): diff
  // against the process, apply in place, record the change, notify supporters.
  async applyLiveEdit(d, processId, editor, sub) {
    const changes = await applyEdit(processId, editor, {
      title: sub.title,
      description: sub.description,
      content: sub.content ?? {},
      links: d.links as ProposedLink[],
    });
    return {
      process_id: processId,
      edited: true,
      changed_fields: changes.changed_fields,
      formatting_only_fields: changes.formatting_only_fields,
    };
  },
};
