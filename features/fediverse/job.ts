// The Fediverse job (every ten minutes, per hub with the feature on): post
// what opened and what was decided since the last run, then deliver every
// post that is due to its followers' servers.
//
// WHERE IT STARTS. The first run after a hub switches the feature on only
// marks the moment: nothing from before is posted, so turning it on never
// floods followers with the hub's history.
//
// EACH ITEM (the default): every new item becomes a post at once. DAILY or
// WEEKLY: the items wait (the cursor does not move) until the roundup is due,
// then one post lists them all; nothing new means no post.

import type { Federation } from "@fedify/fedify";
import type { FeatureHost, PublicActivityItem } from "../../src/sdk/index.js";
import { deliverOnce, type Sender } from "./deliver.js";
import type { FediverseData, HubFacts } from "./federation.js";
import { sweepKv } from "./kv.js";
import {
  hubHashtags,
  itemPost,
  POSTED_KINDS,
  postMode,
  roundupDue,
  roundupPost,
  type PostMode,
} from "./posts.js";
import type { FediverseStore } from "./store.js";
import { isBlocked } from "./limits.js";

/** Where to deliver, less any server the hub's admins have since blocked. */
async function inboxes(deps: JobDeps): Promise<string[]> {
  return (await deps.store.inboxes()).filter((u) => {
    try {
      return !isBlocked(new URL(u).hostname, deps.blocked);
    } catch {
      return false;
    }
  });
}

/** Deliveries one run attempts, and how many at once. */
export const DELIVERIES_PER_RUN = 300;
const AT_ONCE = 10;

export interface JobDeps {
  host: Pick<FeatureHost, "publicActivity">;
  store: FediverseStore;
  facts: HubFacts;
  federation: Federation<FediverseData>;
  send: Sender;
  timeZone: string;
  blocked: readonly string[];
  /** The database's working memory, swept of expired rows; absent in tests. */
  sweep?: (now: Date) => Promise<void>;
  mode?: PostMode;
  tags?: readonly string[];
}

export interface JobResult {
  posted: number;
  delivered: number;
  failed: number;
  gave_up: number;
  started?: boolean;
}

async function newItems(deps: JobDeps, since: string): Promise<{ items: PublicActivityItem[]; cursor: string | null }> {
  const items: PublicActivityItem[] = [];
  let cursor: string | null = null;
  let from = since;
  for (let page = 0; page < 10; page++) {
    const got = await deps.host.publicActivity(from, { kinds: POSTED_KINDS, limit: 500 });
    items.push(...got.items);
    if (!got.cursor) break;
    cursor = got.cursor;
    from = got.cursor;
  }
  return { items, cursor };
}

/** Make this run's posts. */
export async function postNew(deps: JobDeps, now: Date): Promise<{ posted: number; started: boolean }> {
  const { store, facts } = deps;
  const since = await store.getState("cursor");
  if (!since) {
    await store.setState("cursor", now.toISOString());
    return { posted: 0, started: true };
  }
  const mode = deps.mode ?? postMode();
  const tags = deps.tags ?? hubHashtags(facts.name);
  let posted = 0;
  if (mode === "each") {
    const { items, cursor } = await newItems(deps, since);
    if (items.length > 0) {
      const to = await inboxes(deps);
      for (const item of items) {
        if (await store.addPost(itemPost(item, tags, facts.origin, now), to)) posted++;
      }
    }
    if (cursor) await store.setState("cursor", cursor);
    return { posted, started: false };
  }
  const due = roundupDue(mode, now, deps.timeZone, await store.getState("last_roundup"));
  if (!due.due) return { posted: 0, started: false };
  const { items, cursor } = await newItems(deps, since);
  if (items.length > 0) {
    const post = roundupPost(items, mode === "daily" ? "today" : "this week", facts.name, tags, facts.origin, now);
    if (await store.addPost(post, await inboxes(deps))) posted++;
  }
  if (cursor) await store.setState("cursor", cursor);
  await store.setState("last_roundup", due.today);
  return { posted, started: false };
}

/** Attempt the deliveries that are due. */
export async function deliverDue(deps: JobDeps, now: Date): Promise<Omit<JobResult, "posted">> {
  const { store, facts, federation } = deps;
  const due = await store.dueDeliveries(now.toISOString(), DELIVERIES_PER_RUN);
  const out = { delivered: 0, failed: 0, gave_up: 0 };
  if (due.length === 0) return out;
  const ctx = federation.createContext(new URL(`${facts.origin}/`), { facts, store, blocked: deps.blocked });
  const posts = new Map<string, Awaited<ReturnType<FediverseStore["post"]>>>();
  for (let i = 0; i < due.length; i += AT_ONCE) {
    await Promise.all(
      due.slice(i, i + AT_ONCE).map(async (d) => {
        if (!posts.has(d.post_id)) posts.set(d.post_id, await store.post(d.post_id));
        const post = posts.get(d.post_id);
        const result = post
          ? await deliverOnce(ctx, post, d, deps.send, now)
          : ({ delivered: false, status: null, error: "the post is gone", next_attempt_at: null } as const);
        await store.recordDelivery(d, result, now.toISOString());
        if (result.delivered) out.delivered++;
        else if (result.next_attempt_at) out.failed++;
        else out.gave_up++;
      }),
    );
  }
  return out;
}

export async function runFediverseJob(deps: JobDeps, now: Date): Promise<JobResult> {
  await deps.sweep?.(now);
  const { posted, started } = await postNew(deps, now);
  const delivery = await deliverDue(deps, now);
  return { posted, ...delivery, ...(started ? { started } : {}) };
}

export { sweepKv };
