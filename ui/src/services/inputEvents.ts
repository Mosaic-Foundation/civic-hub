// A comment (or a creator's update) just posted, handed to the comment panel
// showing that process, so it appears at once from the server's answer —
// whichever form posted it (the comment form, the vote panel's comment box).
// The panel adds it to its list, or replaces the copy it already has.

import type { CommunityInput } from "./api";

const EVENT = "civic:input-added";

interface Detail {
  processId: string;
  input: CommunityInput;
}

export function announceInput(processId: string, input: CommunityInput): void {
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { processId, input } }));
}

/** Call `onInput` with each comment posted to `processId`; returns the unsubscribe. */
export function onInputAdded(processId: string, onInput: (input: CommunityInput) => void): () => void {
  const listener = (e: Event) => {
    const { detail } = e as CustomEvent<Detail>;
    if (detail?.processId === processId && detail.input) onInput(detail.input);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
