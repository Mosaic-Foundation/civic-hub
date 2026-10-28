// What a tour draft stores and what submitting it creates. The routes, the
// Code of Conduct check and the review queue are the hub's.

import { ValidationError, applyEdit, type Draft, type DraftKind } from "@civic-social/plugin-sdk";
import { TYPE } from "./manifest.js";

export type SdkTourDraft = Draft<{ place: string | null }>;

export const PLACE_MAX = 120;

export const sdkTourDraftKind: DraftKind<SdkTourDraft> = {
  tag: "sdk-tour",
  spec: {
    processType: TYPE,
    // The hub types table names from the configured packages; this fixture is not in the hub's own list.
    table: "sdk_tour_drafts" as DraftKind["spec"]["table"],
    idPrefix: "sdtdraft",
    fields: {
      // A free-text field others read: the Code of Conduct check reads it as "The place".
      place: {
        coc: "The place",
        read: (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null),
        write: (v: unknown) => {
          if (v !== null && typeof v !== "string") throw new ValidationError("The place must be text.");
          const s = (v ?? "").trim();
          if (s.length > PLACE_MAX) throw new ValidationError(`The place can be at most ${PLACE_MAX} characters.`, "too_long");
          return s || null;
        },
        checked: true,
      },
    },
  },
  missing: (d) => {
    if (!d.title.trim()) return "Give the tour a name.";
    if (!d.place) return "Say where the tour is.";
    return null;
  },
  build(d) {
    const state = { place: d.place };
    return { title: d.title.trim(), description: d.description.trim(), state, revise: { state } };
  },
  // A1: the hub has run the Code of Conduct check on the draft; its edit path
  // writes the words and the place together, at the tour's version.
  async applyLiveEdit(_d, processId, editor, submission) {
    const state = (submission.state ?? {}) as Record<string, unknown>;
    const changes = await applyEdit(processId, editor, {
      title: submission.title,
      description: submission.description,
      state: { place: state.place },
    });
    return { process_id: processId, edited: true, changed_fields: changes.changed_fields };
  },
};
