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
// Phase 1 (this): the account, follows and unfollows, the Share on Mastodon
// button (ui/src/components/MastodonShare.tsx), the handle and follower count
// for admins. Phase 2: posting what opens and what is decided. Phase 3:
// replies kept as text, likes and boosts counted.

import { Router, type RequestHandler } from "express";
import { integrateFederation } from "@fedify/express";
import {
  currentHubId,
  getSettingSync,
  hubContext,
  KEYS,
  privateFetchAllowed,
  route,
  sealingAvailable,
  type FeatureHost,
  type FeaturePackage,
} from "../../src/sdk/index.js";
import { FEDIVERSE_MANIFEST } from "./manifest.js";
import { dbStore, type FediverseStore } from "./store.js";
import { federationFor, hubHandle, HUB_ACTOR, type FediverseData, type HubFacts } from "./federation.js";

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

function federationHandler(store: FediverseStore): RequestHandler {
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
    // Fedify reads the request's address from req.protocol and req.host. On
    // Vercel the function sees plain http behind the proxy; the hub's origin
    // is what the sender signed, so the request is read at that origin.
    Object.defineProperty(req, "protocol", { value: origin.protocol.replace(/:$/, ""), configurable: true });
    Object.defineProperty(req, "host", { value: origin.host, configurable: true });
    federationFor(facts.origin, { allowPrivateAddress: privateFetchAllowed() })
      .then((federation) => {
        const data: FediverseData = { facts, store };
        integrateFederation(federation, () => data)(req, res, (err?: unknown) => {
          if (err) return next(err);
          browse(req, res, next);
        });
      })
      .catch(next);
  };
}

function adminRouter(store: FediverseStore): Router {
  const r = Router();
  // GET /admin/fediverse: what the Plugins panel shows.
  r.get(
    "/",
    route(async (_req, res) => {
      const facts = hubFacts();
      res.json({
        handle: hubHandle(facts.origin),
        actor_url: `${facts.origin}/ap/${HUB_ACTOR}`,
        followers: await store.followerCount(),
        ready: sealingAvailable(),
      });
    }),
  );
  return r;
}

const fediverse: FeaturePackage = {
  name: "@civic-social/feature-fediverse",
  version: "0.1.0",
  displayName: "Fediverse",
  manifest: FEDIVERSE_MANIFEST,
  server(host: FeatureHost) {
    const store = dbStore(host);
    return {
      rootHandlers: [{ prefixes: FEDIVERSE_PATHS, handler: federationHandler(store) }],
      adminRoutes: [{ path: "/fediverse", router: adminRouter(store) }],
    };
  },
};

export default fediverse;
