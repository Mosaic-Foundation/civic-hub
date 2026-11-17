// The page a resident drafts a conversation on: the kernel's draft page, with
// this type's kind (./conversationKind.tsx).

import { DraftPage } from "@civic-social/plugin-sdk/ui";
import { conversationKind } from "./conversationKind";

export default function NewConversation() {
  return <DraftPage config={conversationKind} />;
}
