// Step-up: a destructive change needs a fresh emailed code. Callers wrap the
// request in `withStepUp(send)`: the first attempt goes without a code; if
// the server answers step_up_required, a code is emailed, this dialog asks
// for it, and the request is sent again with it.

import { useCallback, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
import StepUpDialog from "./StepUpDialog";

type Send<T> = (extra: Record<string, unknown>) => Promise<T>;

interface Pending {
  what: string;
  /** Why no code was sent, in the server's words; null when one is on its way. */
  notice: string | null;
  resolve: (code: string | null) => void;
}

export function useStepUp(): {
  withStepUp: <T>(what: string, send: Send<T>) => Promise<T | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (what: string, notice: string | null) => new Promise<string | null>((resolve) => setPending({ what, notice, resolve })),
    [],
  );

  const withStepUp = useCallback(
    async <T,>(what: string, send: Send<T>): Promise<T | null> => {
      try {
        return await send({});
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== "step_up_required") throw err;
      }
      // A refused request is said, not hidden: a code waiting from under a
      // minute ago is still the one to enter, and a limit says when to try.
      const notice = await api.requestStepUp().then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      const code = await ask(what, notice);
      if (code === null) return null;
      return send({ step_up_code: code });
    },
    [ask],
  );

  const dialog = pending ? (
    <StepUpDialog
      what={pending.what}
      notice={pending.notice}
      onDone={(code) => {
        pending.resolve(code);
        setPending(null);
      }}
    />
  ) : null;

  return { withStepUp, dialog };
}
