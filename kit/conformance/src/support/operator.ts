// Requests to the test host's operator API (src/operator/router.ts): what a
// console asks of a hub deployment, POST /operator/rpc/<method> with
// { "args": [...] } and the operator token as a bearer. The test host makes
// the suite's throwaway hubs through it, as the console does
// (Mosaic-Foundation/mosaic-console, since the console split).
//
// Answers { result } or, refused, { error, code } with the refusal's status.

import { request } from "node:http";
import { API_BASE } from "./http.js";

/** Must match the server's CIVIC_OPERATOR_TOKEN (CI, the local launch configs and civic-conformance set it). */
export const OPERATOR_TOKEN = process.env.CIVIC_TEST_OPERATOR_TOKEN ?? "local-operator-only";

/** Who the tests act as, in the hub's own records (updated_by, audit actors). */
export const OPERATOR = process.env.CIVIC_TEST_CONSOLE_OPERATOR ?? "operator@example.test";

export interface OperatorResponse {
  status: number;
  /** The method's result when status is 200; { error, code } when refused. */
  body: any;
}

/** One operator API call, answered as it came: status and body. */
export function operatorCall(method: string, ...args: unknown[]): Promise<OperatorResponse> {
  const url = new URL(`${API_BASE}/operator/rpc/${method}`);
  const payload = JSON.stringify({ args });
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${OPERATOR_TOKEN}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          let parsed: any;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { raw };
          }
          resolve({ status, body: status === 200 && parsed && "result" in parsed ? parsed.result : parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** A refused operator call, with what the hub answered. */
export class OperatorRefused extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly body: any,
  ) {
    super(`operator ${method}: ${status} ${JSON.stringify(body)}`);
  }
}

/** One operator API call's result; throws OperatorRefused unless it answered 200. */
export async function operator<T = any>(method: string, ...args: unknown[]): Promise<T> {
  const res = await operatorCall(method, ...args);
  if (res.status !== 200) throw new OperatorRefused(method, res.status, res.body);
  return res.body as T;
}

/** Every mode a hub can be made in: the console's choice, demo by default. */
const ALL_MODES = ["demo", "beta", "live"] as const;

/**
 * Make a hub as the console's Create hub does: check the form, create it,
 * seed samples when asked, add the starter word cloud, invite its admins.
 * Answers 201 with the hub's detail (hub, config, handover, plugins, admins,
 * ai_limits, samples) and what create did (sample_content, starter_wordcloud,
 * invites, message); a refusal answers its status and { error, code }.
 */
export async function createHub(form: Record<string, unknown>, by = OPERATOR): Promise<OperatorResponse> {
  const parsed = await operatorCall("parseCreate", form);
  if (parsed.status !== 200) return parsed;
  const input = parsed.body as { sampleContent?: boolean; admins: string[] };
  const made = await operatorCall("createHub", input, { allowedModes: ALL_MODES, updatedBy: `console:${by}` });
  if (made.status !== 200) return made;
  const hubId = (made.body as { hub: { id: string } }).hub.id;
  let sample: unknown = null;
  if (input.sampleContent) {
    const seeded = await operatorCall("seedSamples", hubId);
    sample = seeded.status === 200 ? seeded.body : { error: seeded.body?.error ?? String(seeded.status) };
  }
  const starter = await operator("addStarterWordcloud", hubId, `console:${by}`);
  const invites = await operator<{ report: unknown; message: string | null }>("inviteAdmins", hubId, input.admins);
  const detail = await operator("hubDetail", hubId);
  return {
    status: 201,
    body: { ...detail, sample_content: sample, starter_wordcloud: starter, invites: invites.report, message: invites.message },
  };
}
