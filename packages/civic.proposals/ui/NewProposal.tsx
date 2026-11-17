// The page a resident drafts a proposal on: the kernel's draft page, with
// this type's kind (./proposalKind.tsx).

import { DraftPage } from "@civic-social/plugin-sdk/ui";
import { proposalKind } from "./proposalKind";

export default function NewProposal() {
  return <DraftPage config={proposalKind} />;
}
