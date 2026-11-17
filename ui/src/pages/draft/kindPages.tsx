// Each drafting kind's page: DraftPage with its kind's config. Loaded with
// the drafting chunk (lazyPages.ts), so the kinds and their forms are too.

import DraftPage from "./DraftPage";
import { conversationKind } from "./conversationKind";
import { voteKind } from "./voteKind";

export function NewConversation() {
  return <DraftPage config={conversationKind} />;
}

export function NewVote() {
  return <DraftPage config={voteKind} />;
}
