// The page a resident drafts a project on (or edits a live one): the kernel's
// draft page, with this type's kind (./projectKind.tsx).

import { DraftPage } from "@civic-social/plugin-sdk/ui";
import { projectKind } from "./projectKind";

export default function NewProject() {
  return <DraftPage config={projectKind} />;
}
