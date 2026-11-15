// Delivering a post to one inbox: the Create activity, signed with the hub's
// RSA key (HTTP Signatures, draft-cavage: what Mastodon checks), POSTed
// through the hub's internal-address block (guardedFetch: every address it
// connects to is checked, redirects are not followed). Retries back off over
// about three days; a 404 or 410 means the inbox is gone, and it is not
// tried again.

import { signRequest, type Context } from "@fedify/fedify";
import type { Activity } from "@fedify/vocab";
import { guardedFetch } from "../../src/sdk/index.js";
import { createFor, HUB_ACTOR, type FediverseData } from "./federation.js";
import { deliverable } from "./limits.js";
import type { Delivery, DeliveryResult, Post } from "./store.js";

/** Sends one signed request; the default is guardedFetch. Tests pass their own. */
export type Sender = (request: Request) => Promise<Response>;

export const guardedSender: Sender = async (request) =>
  guardedFetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.text(),
    redirect: "manual",
    maxBytes: 64 * 1024,
    signal: AbortSignal.timeout(15_000),
  });

/** Minutes to wait after the nth failure (1-based). Past the end: given up. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720, 1440, 1440] as const;

/** When to try again after `attempts` failures, or null to give up. */
export function nextAttempt(attempts: number, now: Date, status: number | null): string | null {
  if (status === 404 || status === 410) return null;
  const wait = BACKOFF_MINUTES[attempts - 1];
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000).toISOString();
}

/** Sign `activity` with the hub's RSA key and POST it to `inbox`, once; the response's status. */
export async function sendSigned(
  ctx: Context<FediverseData>,
  activity: Activity,
  inbox: string,
  send: Sender,
): Promise<number> {
  const body = JSON.stringify(await activity.toJsonLd({ contextLoader: ctx.contextLoader }));
  const [rsa] = await ctx.getActorKeyPairs(HUB_ACTOR);
  if (!rsa) throw new Error("the hub has no signing key");
  const unsigned = new Request(inbox, {
    method: "POST",
    headers: { "Content-Type": "application/activity+json", Accept: "application/activity+json" },
    body,
  });
  const signed = await signRequest(unsigned, rsa.privateKey, rsa.keyId, { spec: "draft-cavage-http-signatures-12" });
  return (await send(signed)).status;
}

/** Deliver `post` to `delivery.inbox_url` once. */
export async function deliverOnce(
  ctx: Context<FediverseData>,
  post: Post,
  delivery: Delivery,
  send: Sender,
  now: Date,
): Promise<DeliveryResult> {
  const fail = (status: number | null, error: string): DeliveryResult => ({
    delivered: false,
    status,
    error,
    next_attempt_at: nextAttempt(delivery.attempts + 1, now, status),
  });
  if (!deliverable(delivery.inbox_url)) return { delivered: false, status: null, error: "not an https address", next_attempt_at: null };
  try {
    const status = await sendSigned(ctx, createFor(ctx, post, ctx.data.facts), delivery.inbox_url, send);
    if (status >= 200 && status < 300) return { delivered: true, status };
    return fail(status, `HTTP ${status}`);
  } catch (err) {
    return fail(null, err instanceof Error ? err.message : String(err));
  }
}
