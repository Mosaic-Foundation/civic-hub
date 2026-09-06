// Headless: renders nothing. Mount it at the moment the person has just
// committed to the process (where the boxed SharePrompt used to render) and
// the page's ShareButton with the same processId shows the callout.
// See shareMoment.ts.

import { useEffect } from "react";
import {
  announceShareMoment,
  shareMomentRetired,
  type ShareMomentReveal,
} from "./shareMomentBus";

interface Props {
  processId: string;
  text: string;
  /** Default "scroll". See ShareMomentReveal in shareMomentBus.ts. */
  reveal?: ShareMomentReveal;
}

export default function ShareMoment({ processId, text, reveal = "scroll" }: Props) {
  useEffect(() => {
    if (shareMomentRetired(processId)) return;
    announceShareMoment(processId, text, reveal);
  }, [processId, text, reveal]);
  return null;
}
