// Each drafting kind's page: DraftPage with its kind's config. Loaded with
// the drafting chunk (lazyPages.ts), so the kinds and their forms are too.

import DraftPage from "./DraftPage";
import { conversationKind } from "./conversationKind";
import { projectKind } from "./projectKind";
import { proposalKind } from "./proposalKind";
import { voteKind } from "./voteKind";

export function NewConversation() {
  return <DraftPage config={conversationKind} />;
}

export function NewProject() {
  return <DraftPage config={projectKind} />;
}

export function NewProposal() {
  return <DraftPage config={proposalKind} />;
}

export function NewVote() {
  return <DraftPage config={voteKind} />;
}
