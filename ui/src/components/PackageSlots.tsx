// Where the kernel draws what packages add to its own pages (kernel step 3,
// docs/kernel/SURFACE.md "Event: couplings that go"). Each process type's UI
// module may say what it contributes (`contributes`, processes/types.ts); the
// kernel draws those of the packages whose plugin is on, in the manifests'
// order, and names none of them.

import { Fragment } from "react";
import { useHub } from "../config/hub";
import { contributionsOn } from "./packageContributions";

/** What packages add at the top of a process page, under its header. */
export function ProcessPageTop({ processId }: { processId: string }) {
  const hub = useHub();
  return (
    <>
      {contributionsOn(hub).map(({ type, contributes: { processTop: Top } }) =>
        Top ? <Top key={type} processId={processId} /> : null,
      )}
    </>
  );
}

/** What packages add to the strip across the top of the hub's public pages. */
export function WelcomeStripSlot() {
  const hub = useHub();
  return (
    <>
      {contributionsOn(hub).map(({ type, contributes: { welcomeStrip: Strip } }) =>
        Strip ? (
          <Fragment key={type}>
            <Strip />
          </Fragment>
        ) : null,
      )}
    </>
  );
}
