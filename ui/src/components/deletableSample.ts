import { useEffect, useState } from "react";
import { adminGetSampleContent } from "../services/api";

// The samples an admin can delete, fetched once per page load and kept until
// a delete, so an item page knows whether to offer the button.
let sampleIds: Promise<Set<string>> | null = null;
function loadSampleIds(): Promise<Set<string>> {
  sampleIds ??= adminGetSampleContent()
    .then((s) => new Set(s.items.map((i) => i.id)))
    .catch(() => {
      sampleIds = null;
      return new Set<string>();
    });
  return sampleIds;
}

/** True once the admin's list says this process is a sample they can delete. */
export function useIsDeletableSample(processId: string, isAdmin: boolean): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    void loadSampleIds().then((ids) => live && setYes(ids.has(processId)));
    return () => {
      live = false;
    };
  }, [processId, isAdmin]);
  return yes;
}

/** Called after a delete, so the next page asks the server again. */
export function forgetSampleIds(): void {
  sampleIds = null;
}
