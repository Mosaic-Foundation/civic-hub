// The operator API over HTTP (src/operator/api.ts, served by
// src/operator/router.ts): what the console calls once it is its own
// deployment. Every method is the same call, POST /operator/rpc/<method>
// with { args }, so the contract is the interface and nothing else.
//
// A refusal comes back as a CivicError with the hub's status, code and
// words, exactly as the in-process implementation throws it, so the
// console's routes answer the same either way.

import { CivicError } from "../errors/index.js";
import { OPERATOR_METHODS, type OperatorApi, type OperatorMethod } from "../operator/api.js";

/** Long enough for the slowest call (an export, the dashboard's hub checks), short of a function's limit. */
const TIMEOUT_MS = 120_000;

type FetchImpl = typeof fetch;

export function httpOperator(baseUrl: string, token: string, fetchImpl: FetchImpl = fetch): OperatorApi {
  const origin = baseUrl.replace(/\/+$/, "");
  async function call(method: OperatorMethod, args: unknown[]): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${origin}/operator/rpc/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ args }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new CivicError(502, "hub_unreachable", `The hub deployment could not be reached (${method}).`, { cause: err });
    }
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown; code?: unknown } | null;
    if (!res.ok) {
      const message = typeof body?.error === "string" ? body.error : `The hub answered ${res.status} to ${method}.`;
      const code = typeof body?.code === "string" ? body.code : "hub_error";
      throw new CivicError(res.status, code, message);
    }
    return body?.result ?? null;
  }
  const api = {} as Record<OperatorMethod, (...args: unknown[]) => Promise<unknown>>;
  for (const m of OPERATOR_METHODS) api[m] = (...args: unknown[]) => call(m, args);
  return api as unknown as OperatorApi;
}
