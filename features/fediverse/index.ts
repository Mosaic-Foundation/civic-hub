// Fediverse: an account for the hub that people follow from Mastodon and the
// rest of the fediverse (plan of 2026-11-12, agreed with Ben Goering's
// feedback). Off until a hub switches it on (plugin.fediverse.enabled; the
// one feature whose default is off, src/shared/hubFeatures.ts).
//
// A hub feature built as a plugin package is (src/plugins/feature.ts), and
// not a plugin package: it calls other servers and answers them, which a
// package's grant refuses. Built on Fedify, which does the protocol's fiddly
// parts (signatures, WebFinger, NodeInfo).
//
// Phase 1: the account, follows and unfollows, the Share on Mastodon button
// (ui/src/components/MastodonShare.tsx), the handle and follower count for
// admins. Phase 2: posts of what opens and what is decided (posts.ts), each
// item or a daily or weekly roundup, delivered by the job (job.ts) with
// retries; the security audit's limits (limits.ts) and shared working memory
// (kv.ts); the followers card in Admin → Activity. Phase 3: replies kept as
// text, likes and boosts counted.

import { Router, type Request as ExpressRequest, type RequestHandler } from "express";
import { integrateFederation } from "@fedify/express";
import {
  currentHubId,
  getSettingSync,
  hubContext,
  KEYS,
  NotFoundError,
  privateFetchAllowed,
  route,
  sealingAvailable,
  ValidationError,
  type FeatureHost,
  type FeaturePackage,
} from "../../src/sdk/index.js";
import type { KvStore } from "@fedify/fedify";
import { FEDIVERSE_MANIFEST } from "./manifest.js";
import { dbStore, type FediverseStore } from "./store.js";
import { federationFor, hubHandle, HUB_ACTOR, type FediverseData, type HubFacts } from "./federation.js";
import { dbKv, sweepKv } from "./kv.js";
import {
  blockedServers,
  isBlocked,
  LIMIT_WINDOW_MS,
  PER_HUB_LIMIT,
  PER_SERVER_LIMIT,
  signingServer,
} from "./limits.js";
import { guardedSender } from "./deliver.js";
import { runFediverseJob } from "./job.js";
import { postMode } from "./posts.js";

/** The paths the account answers on, at the root of the hub's address. */
export const FEDIVERSE_PATHS = ["/.well-known/webfinger", "/.well-known/nodeinfo", "/nodeinfo", "/ap"] as const;

function setting(key: string): string | null {
  const v = getSettingSync(key)?.trim();
  return v ? v : null;
}

/** The hub in scope, as its account shows it. */
export function hubFacts(): HubFacts {
  const hub = hubContext();
  return {
    hubId: currentHubId(),
    origin: hub.baseUrl,
    name: hub.name,
    about: setting(KEYS.IDENTITY_DESCRIPTION) ?? setting(KEYS.IDENTITY_TAGLINE),
    logoUrl: setting(KEYS.IDENTITY_LOGO_URL),
    bannerUrl: setting(KEYS.IDENTITY_BANNER_URL),
  };
}

function federation(facts: HubFacts, kv: KvStore) {
  return federationFor(facts.origin, { kv, allowPrivateAddress: privateFetchAllowed() });
}

/**
 * Before Fedify reads a delivery to the inbox: refuse a blocked server (403)
 * and a server over its rate limit, or an inbox over its own (429). The
 * sender is the server whose key signed the request; Fedify then checks that
 * key and that the message's account is its owner.
 */
async function inboxGate(host: FeatureHost, req: ExpressRequest, blocked: readonly string[]): Promise<{ status: number; message: string } | null> {
  const server = signingServer({ get: (name) => req.get(name) ?? null });
  if (!server) return null;
  if (isBlocked(server, blocked)) return { status: 403, message: "This server is blocked by the hub." };
  const hub = currentHubId();
  const over = await host.rateLimit([
    { scope: "fediverse.inbox", by: "server", value: `${hub}:${server}`, limit: PER_SERVER_LIMIT, windowMs: LIMIT_WINDOW_MS },
    { scope: "fediverse.inbox", by: "hub", value: hub, limit: PER_HUB_LIMIT, windowMs: LIMIT_WINDOW_MS },
  ]);
  return over ? { status: 429, message: "Too many messages; try again later." } : null;
}

function federationHandler(host: FeatureHost, store: FediverseStore, kv: KvStore): RequestHandler {
  const browse = Router();
  // A person who opens the account's address in a browser goes to the hub.
  browse.get(/^\/ap(\/.*)?$/, (_req, res) => res.redirect(302, "/"));
  return (req, res, next) => {
    // Without the secret that seals its keys the account cannot sign, so it
    // does not answer at all (production only: elsewhere a development key
    // is used).
    if (!sealingAvailable()) return next();
    const facts = hubFacts();
    const origin = new URL(facts.origin);
    const blocked = blockedServers();
    // Fedify reads the request's address from req.protocol and req.host. On
    // Vercel the function sees plain http behind the proxy; the hub's origin
    // is what the sender signed, so the request is read at that origin.
    Object.defineProperty(req, "protocol", { value: origin.protocol.replace(/:$/, ""), configurable: true });
    Object.defineProperty(req, "host", { value: origin.host, configurable: true });
    const gate = req.method === "POST" && /\/inbox$/.test(req.path) ? inboxGate(host, req, blocked) : Promise.resolve(null);
    gate
      .then(async (refused) => {
        if (refused) {
          res.status(refused.status).json({ error: refused.message });
          return;
        }
        const data: FediverseData = { facts, store, blocked };
        integrateFederation(await federation(facts, kv), () => data)(req, res, (err?: unknown) => {
          if (err) return next(err);
          browse(req, res, next);
        });
      })
      .catch(next);
  };
}

/** GET /fediverse/posts/:id: a post as the hub's roundup page shows it. Public, like the post itself. */
function publicRouter(store: FediverseStore): Router {
  const r = Router();
  // GET /fediverse/posts?process=<id>: the hub's own post about a process, if
  // it made one, so Share on Mastodon can open that post (to boost or reply)
  // instead of composing a new one. Public, like the post.
  r.get(
    "/posts",
    route(async (req, res) => {
      const pid = String(req.query.process ?? "");
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(pid)) throw new ValidationError("process is a process id");
      const post = await store.postForProcess(pid);
      if (!post) throw new NotFoundError("The hub has not posted this");
      res.json({ id: post.id, note: `${hubFacts().origin}/ap/${HUB_ACTOR}/posts/${post.id}`, published_at: post.published_at });
    }),
  );
  r.get(
    "/posts/:id",
    route(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!/^[a-z0-9_-]{6,64}$/.test(id)) throw new ValidationError("Not a post id");
      const post = await store.post(id);
      if (!post) throw new NotFoundError("No such post");
      res.json({ id: post.id, kind: post.kind, published_at: post.published_at, url: post.url, items: post.items ?? [] });
    }),
  );
  return r;
}

/** One run of the job for the hub in scope: the scheduled job's, and the panel's "Post now". */
async function runForHub(host: FeatureHost, store: FediverseStore, kv: KvStore, now: Date) {
  const facts = hubFacts();
  return runFediverseJob(
    {
      host,
      store,
      facts,
      federation: await federation(facts, kv),
      send: guardedSender,
      timeZone: hubContext().timeZone,
      blocked: blockedServers(),
      sweep: (at) => sweepKv(host, at),
    },
    now,
  );
}

function adminRouter(host: FeatureHost, store: FediverseStore, kv: KvStore): Router {
  const r = Router();
  // POST /admin/fediverse/run: "Post now". What the ten-minute job would do,
  // for this hub, at once (and on a deployment whose scheduled jobs are off).
  r.post(
    "/run",
    route(async (_req, res) => {
      if (!sealingAvailable()) throw new ValidationError("CIVIC_FEDIVERSE_SECRET is not set, so the hub cannot sign posts");
      const limited = await host.rateLimit([
        { scope: "fediverse.run", by: "hub", value: currentHubId(), limit: 30, windowMs: 60 * 60 * 1000 },
      ]);
      if (limited) throw new ValidationError("That's a lot of runs this hour; the job runs every ten minutes anyway.");
      res.json(await runForHub(host, store, kv, new Date()));
    }),
  );
  // GET /admin/fediverse: what the Plugins panel shows.
  r.get(
    "/",
    route(async (_req, res) => {
      const facts = hubFacts();
      res.json({
        handle: hubHandle(facts.origin),
        actor_url: `${facts.origin}/ap/${HUB_ACTOR}`,
        followers: await store.followerCount(),
        posts: await store.postCount(),
        post_mode: postMode(),
        ready: sealingAvailable(),
      });
    }),
  );
  // GET /admin/fediverse/followers?from=&to=: Admin → Activity's card: followers,
  // and replies, likes and boosts of the hub's posts in the period.
  r.get(
    "/followers",
    route(async (req, res) => {
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!day.test(from) || !day.test(to) || from > to) throw new ValidationError("from and to are days, YYYY-MM-DD, from first");
      const end = new Date(`${to}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const start = `${from}T00:00:00Z`;
      res.json({
        total: await store.followerCount(),
        new_in_period: await store.followersSince(start, end.toISOString()),
        // Replies, likes and boosts of the hub's posts in the period (phase 3).
        ...(await store.returnsSince(start, end.toISOString())),
      });
    }),
  );
  return r;
}

const fediverse: FeaturePackage = {
  name: "@civic-social/feature-fediverse",
  version: "0.2.0",
  displayName: "Fediverse",
  manifest: FEDIVERSE_MANIFEST,
  server(host: FeatureHost) {
    const store = dbStore(host);
    const kv = dbKv(host);
    return {
      rootHandlers: [{ prefixes: FEDIVERSE_PATHS, handler: federationHandler(host, store, kv) }],
      // In civic.json (docs/FEDIVERSE.md, "Following a hub both ways"): the
      // account whose posts repeat what the hub's /events carries.
      discovery: () => {
        if (!sealingAvailable()) return null;
        const facts = hubFacts();
        return {
          actor: `${facts.origin}/ap/${HUB_ACTOR}`,
          handle: hubHandle(facts.origin),
          outbox: `${facts.origin}/ap/${HUB_ACTOR}/outbox`,
          repeats: `${facts.origin}/events`,
        };
      },
      routes: [{ path: "/fediverse", router: publicRouter(store) }],
      adminRoutes: [{ path: "/fediverse", router: adminRouter(host, store, kv) }],
      jobs: {
        fediverse: async ({ now }) => {
          if (!sealingAvailable()) return { status: 200, body: { skipped: true, reason: "CIVIC_FEDIVERSE_SECRET is not set" } };
          return { status: 200, body: { ...(await runForHub(host, store, kv, now)) } };
        },
      },
    };
  },
};

export default fediverse;
