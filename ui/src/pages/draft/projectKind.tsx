import { type ProjectDraft } from "../../services/api";
import { demoSubmitNote } from "../../config/demoCopy";
import { reviewDestination, type DraftKindConfig } from "./types";
import ProjectForm from "./forms/ProjectForm";


export const projectKind: DraftKindConfig<ProjectDraft> = {
  kind: "project",
  processType: "civic.project",
  emptyDraft: {
    id: "",
    user_id: "",
    title: "",
    description: "",
    sources: "",
    banner_image_url: null,
    banner_image_alt: null,
    conversation_history: [],
    last_review_result: null,
    draft_modified_since_review: false,
    assistant_helped: false,
    status: "drafting",
    created_at: "",
    updated_at: "",
    links: [],
  },
  applyFields: () => ["title", "description", "sources"],
  // Edit of a LIVE project (from "Edit project"): same reopened draft, but
  // submit applies the diff in place, records it, and notifies supporters.
  shell: (ctx) => ({
    backTo: ctx.editProcessId ? `/project/${ctx.editProcessId}` : "/projects",
    backLabel: ctx.editProcessId ? "Cancel editing" : "Projects",
    backAsButton: !!ctx.editProcessId,
    title: ctx.editProcessId ? "Edit your project" : ctx.reviseReviewId ? "Revise your project" : "Start a project",
    noAssistant: !!ctx.editProcessId,
  }),
  Form: ProjectForm,
  confirm: {
    title: (ctx) => (ctx.editProcessId ? "Submit your edits" : "Submit your project"),
    finality: (ctx) =>
      ctx.editProcessId
        ? "Your edits go live right away. The previous version stays visible on the project page under \"See what changed\", and people who support this project will be told it was edited."
        : ctx.isAdmin
          ? "Once submitted, your project can only be changed through Edit project, which keeps a visible history of every change."
          : ctx.hub.demo_mode
            ? demoSubmitNote("project")
            : "Your project will be submitted for review before going live. You'll be notified when an admin has reviewed it.",
    finalityEdit: (ctx) => !!ctx.editProcessId,
    noun: "project",
    audience: "Visitors",
    confirmLabel: (ctx) =>
      ctx.editProcessId ? "Submit edits" : ctx.isAdmin ? "Submit project" : ctx.hub.demo_mode ? "Submit" : "Submit for review",
  },
  liveUrl: (id) => `/project/${id}`,
  submit: async (api, draft, ctx) => {
    if (ctx.editProcessId) {
      const edited = await api.submit(draft.id, { edit_process_id: ctx.editProcessId });
      const r = edited as { changed_fields?: string[]; formatting_only_fields?: string[] };
      return {
        to: `/project/${ctx.editProcessId}${(r.changed_fields ?? []).length ? "#edits" : ""}`,
        state: { edited: true, changed: r.changed_fields ?? [], formatting: r.formatting_only_fields ?? [] },
      };
    }
    const result = await api.submit(draft.id, ctx.reviseReviewId ? { review_id: ctx.reviseReviewId } : undefined);
    return reviewDestination(result, (id) => `/project/${id}`);
  },
};
