// The "consider sharing this" moment, decoupled from where it is shown.
//
// A page knows WHEN the person has just committed — endorsed, voted, backed,
// taken part — but the share row it should point at lives elsewhere on the
// page (and, on a long vote page, several screens up). So the moment is
// announced here by id, and whichever ShareButton carries that process id
// picks it up and shows a brief callout beside its own buttons — no second
// share row, nothing to dismiss (Adam, 2026-09-06: "a little bubble pop up
// and point to the share bar … and just disappear after five seconds").
//
// Once per process per browser. The localStorage key is the one the old
// boxed prompt used, so anyone who already dismissed that never sees this.

const KEY_PREFIX = "civic:share-prompt:";

/** How the bar reveals the callout.
 *  - "scroll": bring the bar into view now and show it — the person just
 *    acted once (voted, endorsed, backed) and is done.
 *  - "when-visible": arm it, and show it the next time the bar scrolls into
 *    view on its own. For conversations, where people vote on statement
 *    after statement: yanking them up to the bar after the third vote would
 *    interrupt them mid-flow (Adam, 2026-09-06). Scrolling back up is the
 *    natural "I'm done" gesture, and that is when it appears. */
export type ShareMomentReveal = "scroll" | "when-visible";

export interface ShareMoment {
  text: string;
  reveal: ShareMomentReveal;
}

type Listener = (moment: ShareMoment) => void;
const listeners = new Map<string, Set<Listener>>();
// Announced before any ShareButton for that id mounted — delivered on
// subscribe, so render order never matters.
const pending = new Map<string, ShareMoment>();

export function shareMomentRetired(processId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + processId) === "1";
  } catch {
    return false;
  }
}

export function retireShareMoment(processId: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + processId, "1");
  } catch {
    /* best effort — the callout still shows once this view */
  }
}

export function announceShareMoment(
  processId: string,
  text: string,
  reveal: ShareMomentReveal = "scroll",
): void {
  const moment = { text, reveal };
  const set = listeners.get(processId);
  if (set && set.size > 0) {
    set.forEach((l) => l(moment));
  } else {
    pending.set(processId, moment);
  }
}

export function subscribeShareMoments(processId: string, listener: Listener): () => void {
  let set = listeners.get(processId);
  if (!set) {
    set = new Set();
    listeners.set(processId, set);
  }
  set.add(listener);
  const queued = pending.get(processId);
  if (queued !== undefined) {
    pending.delete(processId);
    queueMicrotask(() => listener(queued));
  }
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(processId);
  };
}
