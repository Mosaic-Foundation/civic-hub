// The hub's fediverse account, served with Fedify (fedify.dev).
//
// ONE ACCOUNT PER HUB. Its address is fixed, /ap/hub on the hub's own origin
// (https://floyd.civic.social/ap/hub), so the name people type can change
// without breaking a single follow: servers remember the address, not the
// name. The name is the hub's hostname as the username
// (@floyd.civic.social@floyd.civic.social, Ben's suggestion, to be tested
// against the short form before a hub goes live); the short form
// (@floyd@floyd.civic.social) finds the same account.
//
// WHAT IT ANSWERS (phase 1):
//   /.well-known/webfinger   finding the account by its handle
//   /.well-known/nodeinfo,   what software this is (Mastodon shows it)
//   /nodeinfo/2.1
//   /ap/hub                  the profile: name, logo, banner, about, website
//   /ap/hub/inbox, /ap/inbox Follow, Undo(Follow), Delete(the follower's account)
//   /ap/hub/outbox           empty until phase 2 posts
//   /ap/hub/followers        the count only, never who
//
// A Follow is accepted at once and the follower stored; an Undo removes them.
// Every incoming activity's HTTP signature is verified by Fedify against the
// sending account's key before any listener runs.
//
// ONE DEPLOYMENT, MANY HUBS. A Federation is built per hub origin (its
// `origin` option), so every address it makes is the hub's own and nothing
// is read from forwarded headers. Built lazily and kept per instance.

import { createFederationBuilder, MemoryKvStore, type Context, type Federation } from "@fedify/fedify";
import {
  Accept,
  Delete,
  Endpoints,
  Follow,
  Image,
  isActor,
  PropertyValue,
  Service,
  Undo,
  type Actor,
} from "@fedify/vocab";
import { hubKeyPairs } from "./keys.js";
import type { FediverseStore } from "./store.js";

/** The one actor's identifier in its addresses. */
export const HUB_ACTOR = "hub";

/** What a hub's account says about it, read per request. */
export interface HubFacts {
  hubId: string;
  /** The hub's origin: https://floyd.civic.social. */
  origin: string;
  name: string;
  /** Its about text: the description, else the tagline. Plain text. */
  about: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
}

/** What each request hands the federation. */
export interface FediverseData {
  facts: HubFacts;
  store: FediverseStore;
}

/** The hostname a hub's handle is made from. */
export function hubHost(origin: string): string {
  return new URL(origin).hostname;
}

/** The username shown: the hub's hostname (floyd.civic.social). */
export function hubUsername(origin: string): string {
  return hubHost(origin);
}

/** The handle people type to find the hub: @floyd.civic.social@floyd.civic.social. */
export function hubHandle(origin: string): string {
  const host = hubHost(origin);
  return `@${hubUsername(origin)}@${host}`;
}

/** The usernames that find the hub: its hostname, and its hostname's first part. */
export function acceptedUsernames(origin: string): string[] {
  const host = hubHost(origin);
  return [...new Set([host, host.split(".")[0], HUB_ACTOR])];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The profile's about text, as the HTML fediverse apps show. */
export function profileSummary(facts: HubFacts): string {
  const about = facts.about?.trim();
  const parts = about ? about.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`) : [];
  const link = `<a href="${escapeHtml(facts.origin)}/">${escapeHtml(hubHost(facts.origin))}</a>`;
  parts.push(
    `<p>An independent Civic Hub. This account posts what opens and what is decided on ${link}. ` +
      `Voting and commenting happen on the hub, by verified residents.</p>`,
  );
  return parts.join("");
}

function absolute(url: string | null, origin: string): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url, `${origin}/`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

const builder = createFederationBuilder<FediverseData>();

builder
  .setActorDispatcher("/ap/{identifier}", async (ctx, identifier) => {
    if (identifier !== HUB_ACTOR) return null;
    const { facts } = ctx.data;
    const keys = await ctx.getActorKeyPairs(identifier);
    const logo = absolute(facts.logoUrl, facts.origin);
    const banner = absolute(facts.bannerUrl, facts.origin);
    const site = `${facts.origin}/`;
    return new Service({
      id: ctx.getActorUri(identifier),
      preferredUsername: hubUsername(facts.origin),
      name: facts.name,
      summary: profileSummary(facts),
      url: new URL(site),
      inbox: ctx.getInboxUri(identifier),
      outbox: ctx.getOutboxUri(identifier),
      followers: ctx.getFollowersUri(identifier),
      endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
      publicKey: keys[0]?.cryptographicKey,
      assertionMethods: keys.map((k) => k.multikey),
      icon: logo ? new Image({ url: logo }) : null,
      image: banner ? new Image({ url: banner }) : null,
      attachments: [
        new PropertyValue({ name: "Website", value: `<a href="${escapeHtml(site)}">${escapeHtml(hubHost(facts.origin))}</a>` }),
      ],
      manuallyApprovesFollowers: false,
      discoverable: true,
      indexable: true,
    });
  })
  .setKeyPairsDispatcher(async (ctx, identifier) => {
    if (identifier !== HUB_ACTOR) return [];
    return hubKeyPairs(ctx.data.store, ctx.data.facts.hubId);
  })
  .mapHandle((ctx, username) =>
    acceptedUsernames(ctx.data.facts.origin).includes(username.toLowerCase()) ? HUB_ACTOR : null,
  );

builder
  .setFollowersDispatcher("/ap/{identifier}/followers", (_ctx, identifier) =>
    // Who follows the hub is not published: the collection says how many.
    identifier === HUB_ACTOR ? { items: [] } : null,
  )
  .setCounter((ctx, identifier) => (identifier === HUB_ACTOR ? ctx.data.store.followerCount() : null));

builder
  .setOutboxDispatcher("/ap/{identifier}/outbox", (_ctx, identifier) =>
    // Phase 2 posts here.
    identifier === HUB_ACTOR ? { items: [] } : null,
  )
  .setCounter((_ctx, identifier) => (identifier === HUB_ACTOR ? 0 : null));

builder.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
  software: { name: "civic-hub", version: "0.1.0", homepage: new URL("https://civic.social/") },
  protocols: ["activitypub"],
  usage: { users: { total: 1, activeHalfyear: 1, activeMonth: 1 }, localPosts: 0, localComments: 0 },
  openRegistrations: false,
}));

/** Whether `uri` is this hub's account. */
function isHub(ctx: Context<FediverseData>, uri: URL | null): boolean {
  if (!uri) return false;
  const parsed = ctx.parseUri(uri);
  return parsed?.type === "actor" && parsed.identifier === HUB_ACTOR;
}

builder
  .setInboxListeners("/ap/{identifier}/inbox", "/ap/inbox")
  .on(Follow, async (ctx, follow) => {
    if (!follow.id || !follow.actorId || !isHub(ctx, follow.objectId)) return;
    const follower = await follow.getActor(ctx);
    if (!isActor(follower) || !follower.id || follower.id.href !== follow.actorId.href) return;
    const inbox = follower.inboxId;
    if (!inbox) return;
    await ctx.data.store.addFollower({
      actor_uri: follower.id.href,
      inbox_url: inbox.href,
      shared_inbox_url: follower.endpoints?.sharedInbox?.href ?? null,
      handle: followerHandle(follower),
      follow_id: follow.id.href,
    });
    await ctx.sendActivity(
      { identifier: HUB_ACTOR },
      follower,
      new Accept({
        id: new URL(`#accepts/${crypto.randomUUID()}`, ctx.getActorUri(HUB_ACTOR)),
        actor: ctx.getActorUri(HUB_ACTOR),
        object: follow,
      }),
    );
  })
  .on(Undo, async (ctx, undo) => {
    if (!undo.actorId) return;
    const object = await undo.getObject(ctx);
    if (!(object instanceof Follow) || !isHub(ctx, object.objectId)) return;
    // The Undo's actor is the account that signed it (Fedify checks), so it
    // can only take back its own follow.
    if (object.actorId && object.actorId.href !== undo.actorId.href) return;
    await ctx.data.store.removeFollower(undo.actorId.href);
  })
  .on(Delete, async (ctx, del) => {
    // An account that deletes itself stops following. Posts deleted by their
    // author are phase 3 (replies).
    if (del.actorId && del.objectId && del.objectId.href === del.actorId.href) {
      await ctx.data.store.removeFollower(del.actorId.href);
    }
  });

function followerHandle(actor: Actor): string | null {
  const user = actor.preferredUsername?.toString();
  const host = actor.id?.hostname;
  return user && host ? `@${user}@${host}`.slice(0, 600) : null;
}

/** Options that differ between production and tests. */
export interface FederationSettings {
  /** Tests only: reach servers on private and loopback addresses. */
  allowPrivateAddress?: boolean;
}

const kv = new MemoryKvStore();
const built = new Map<string, Promise<Federation<FediverseData>>>();

/** The hub at `origin`'s federation, built once per instance. */
export function federationFor(origin: string, settings: FederationSettings = {}): Promise<Federation<FediverseData>> {
  const key = `${origin}|${settings.allowPrivateAddress ? "private" : "public"}`;
  let f = built.get(key);
  if (!f) {
    f = builder.build({
      kv,
      // Handles name the hostname alone, even where a development origin has a port.
      origin: { handleHost: hubHost(origin), webOrigin: origin },
      allowPrivateAddress: settings.allowPrivateAddress === true,
      userAgent: { software: "CivicHub/0.1.0", url: new URL(`${origin}/`) },
    });
    built.set(key, f);
  }
  return f;
}
