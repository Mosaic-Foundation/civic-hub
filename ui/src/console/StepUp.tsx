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
  resolve: (code: string | null) => void;
}

export function useStepUp(): {
  withStepUp: <T>(what: string, send: Send<T>) => Promise<T | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (what: string) => new Promise<string | null>((resolve) => setPending({ what, resolve })),
    [],
  );

  const withStepUp = useCallback(
    async <T,>(what: string, send: Send<T>): Promise<T | null> => {
      try {
        return await send({});
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== "step_up_required") throw err;
      }
      // A throttled request (a code was sent under 30 s ago) is fine: that
      // code is still the one to enter.
      await api.requestStepUp().catch(() => undefined);
      const code = await ask(what);
      if (code === null) return null;
      return send({ step_up_code: code });
    },
    [ask],
  );

  const dialog = pending ? (
    <StepUpDialog
      what={pending.what}
      onDone={(code) => {
        pending.resolve(code);
        setPending(null);
      }}
    />
  ) : null;

  return { withStepUp, dialog };
}
