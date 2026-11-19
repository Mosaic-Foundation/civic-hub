// The page a resident drafts a vote on: the kernel's draft page, with this
// type's kind (./voteKind.tsx).

import { DraftPage } from "@civic-social/plugin-sdk/ui";
import { voteKind } from "./voteKind";

export default function NewVote() {
  return <DraftPage config={voteKind} />;
}
