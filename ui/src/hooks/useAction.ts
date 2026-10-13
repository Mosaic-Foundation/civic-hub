// useAction — the one way a page runs an action (a vote, an endorsement, a
// comment, an approval…), so every action behaves the same:
//
//   - one at a time: a second press while one is running does nothing. The
//     lock is a ref, so two clicks inside one frame can't both get through
//     (a `busy` state alone is read stale by the second click's closure);
//   - `busy` is true while it runs, for the button's "Saving…" label and
//     `disabled`;
//   - a refusal's message lands in `error` (the server's sentence, from the
//     agreed error shape), and the previous error clears when the next try
//     starts.
//
// The action's answer is the page's new state: process actions answer
// `{ result, view }` and the page sets its process to `view`, so the result
// shows at once with no reload. `run` resolves to the action's value, or
// undefined when it was refused, already running, or the page has gone.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ActionRunner {
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  run: <T>(fn: () => Promise<T>, opts?: { onError?: (err: unknown) => string | null | void }) => Promise<T | undefined>;
}

export function useAction(fallbackMessage = "That didn't go through. Please try again."): ActionRunner {
  const lock = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts?: { onError?: (err: unknown) => string | null | void }) => {
      if (lock.current) return undefined;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        // onError may handle the refusal itself: a string replaces the
        // message, null shows none, undefined keeps the server's.
        const own = opts?.onError?.(err);
        if (mounted.current && own !== null) {
          setError(typeof own === "string" ? own : err instanceof Error && err.message ? err.message : fallbackMessage);
        }
        return undefined;
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [fallbackMessage],
  );

  return { busy, error, setError, run };
}
