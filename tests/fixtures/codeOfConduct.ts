// The hash a draft's Code of Conduct result must carry to count for the
// draft's current text (src/services/codeOfConduct.ts). Tests that fake a
// passed check by writing the draft row directly write this with it, so the
// row looks exactly as if the check had run on that text.

import {
  codeOfConductFields,
  codeOfConductHash,
  toDraftState,
} from "../../src/services/codeOfConduct.js";

export function checkedHashFor(fields: {
  title: string;
  description: string;
  sources?: string;
  considerations?: string;
  seed_statements?: string;
  options?: string;
}): string {
  return codeOfConductHash(
    codeOfConductFields(
      toDraftState({
        id: "",
        user_id: "",
        status: "drafting",
        conversation_history: [],
        sources: "",
        considerations: "",
        ...fields,
      }),
    ),
  );
}

/**
 * Markers the fake Code of Conduct check (CIVIC_COC_FAKE=on on the hub under
 * test; src/debug/fakeCodeOfConduct.ts) answers to: flagged, and down.
 */
import { FAKE_COC_DOWN, FAKE_COC_FLAG } from "../../src/debug/fakeCodeOfConduct.js";
export const COC_FLAG = FAKE_COC_FLAG;
export const COC_DOWN = FAKE_COC_DOWN;

/**
 * A resident's proposal waiting in the review queue, made the way a resident
 * makes one: a draft, and a Submit whose Code of Conduct check could not run
 * (so even a demo hub sends it to an admin). For tests that need "a pending
 * review"; the generic POST /reviews/submit they used is gone.
 */
export async function pendingProposalReview(
  host: string,
  token: string,
  title: string,
): Promise<{ review_id: string; process_id: string }> {
  const { call } = await import("./hostCall.js");
  const draft = await call("POST", "/proposals/drafts", host, { category: "idea" }, token);
  if (draft.status !== 201) throw new Error(`draft: ${draft.status} ${JSON.stringify(draft.body)}`);
  await call("PATCH", `/proposals/drafts/${draft.body.id}`, host, { title, description: `Waiting for an admin. ${COC_DOWN}` }, token);
  const res = await call("POST", `/proposals/drafts/${draft.body.id}/submit`, host, {}, token);
  if (res.status !== 201 || res.body.auto_approved) {
    throw new Error(`submit: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { review_id: res.body.review_id, process_id: res.body.process_id };
}
