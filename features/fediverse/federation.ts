// The hub's fediverse account, served with Fedify (fedify.dev).
//
// ONE ACCOUNT PER HUB. Its address is fixed, /ap/hub on the hub's own origin
// (https://floyd.civic.social/ap/hub), so the name people type can change
// without breaking a single follow: servers remember the address, not the
// name. The username is the first part of the hub's hostname
// (@floyd@floyd.civic.social; Adam's pick, 2026-11-14, of four forms tested
// on dev). The whole hostname as the username, Ben's first suggestion
// (@floyd.civic.social@floyd.civic.social), still finds the same account.
//
// WHAT IT ANSWERS (phase 1):
//   /.well-known/webfinger   finding the account by its handle
//   /.well-known/nodeinfo,   what software this is (Mastodon shows it)
//   /nodeinfo/2.1
//   /ap/hub                  the profile: name, logo, banner, about, website
//   /ap/hub/inbox, /ap/inbox Follow, Undo(Follow), Delete(the follower's account)
//   /ap/hub/outbox           its posts, newest first; /ap/hub/posts/<id> one post
//   /ap/hub/followers        the count only, never who
//
// A Follow is accepted at once and the follower stored; an Undo removes them.
// Every incoming activity's HTTP signature is verified by Fedify against the
// sending account's key before any listener runs.
//
// ONE DEPLOYMENT, MANY HUBS. A Federation is built per hub origin (its
// `origin` option), so every address it makes is the hub's own and nothing
// is read from forwarded headers. Built lazily and kept per instance.

import { createFederationBuilder, type Context, type Federation, type KvStore } from "@fedify/fedify";
import {
  Accept,
  Create,
  Delete,
  Endpoints,
  Follow,
  Hashtag,
  Image,
  isActor,
  Link,
  Note,
  PropertyValue,
  PUBLIC_COLLECTION,
  Reject,
  Service,
  Undo,
  type Actor,
} from "@fedify/vocab";
import { Temporal } from "temporal-polyfill";
import { hubKeyPairs } from "./keys.js";
import { deliverable, FOLLOWER_CEILING, isBlocked } from "./limits.js";
import type { FediverseStore, Post } from "./store.js";

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
  /** Servers the hub's admins blocked (limits.ts). */
  blocked: readonly string[];
  facts: HubFacts;
  store: FediverseStore;
}

/** The hostname a hub's handle is made from. */
export function hubHost(origin: string): string {
  return new URL(origin).hostname;
}

/** The username shown: the first part of the hub's hostname (floyd). */
export function hubUsername(origin: string): string {
  return hubHost(origin).split(".")[0];
}

/** The handle people type to find the hub: @floyd@floyd.civic.social. */
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

/**
 * The hub's profile picture: its logo, else a letter picture of its name's
 * first letter (ui/public/fediverse-avatars/A.png … Z.png, navy with a white
 * letter; Mastodon shows no SVG, so they are PNGs made once). "C" for a
 * name that starts with no letter A–Z.
 */
export function avatarUrl(facts: HubFacts): URL | null {
  const logo = absolute(facts.logoUrl, facts.origin);
  if (logo) return logo;
  const letter = /[a-z]/i.exec(facts.name.normalize("NFKD"))?.[0]?.toUpperCase() ?? "C";
  return absolute(`/fediverse-avatars/${letter}.png`, facts.origin);
}

/** What the profile shows, for telling when it changed (profileFingerprint). */
export function profileFacts(facts: HubFacts): Record<string, string | null> {
  return {
    username: hubUsername(facts.origin),
    name: facts.name,
    summary: profileSummary(facts),
    icon: avatarUrl(facts)?.href ?? null,
    image: absolute(facts.bannerUrl, facts.origin)?.href ?? null,
  };
}

/** The hub's account, as its address answers and as an Update announces it. */
export async function hubActor(ctx: Context<FediverseData>): Promise<Service> {
  const { facts } = ctx.data;
  const keys = await ctx.getActorKeyPairs(HUB_ACTOR);
  const logo = avatarUrl(facts);
  const banner = absolute(facts.bannerUrl, facts.origin);
  const site = `${facts.origin}/`;
  return new Service({
    id: ctx.getActorUri(HUB_ACTOR),
    preferredUsername: hubUsername(facts.origin),
    name: facts.name,
    summary: profileSummary(facts),
    url: new URL(site),
    inbox: ctx.getInboxUri(HUB_ACTOR),
    outbox: ctx.getOutboxUri(HUB_ACTOR),
    followers: ctx.getFollowersUri(HUB_ACTOR),
    endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
    publicKey: keys[0]?.cryptographicKey,
    assertionMethods: keys.map((k) => k.multikey),
    icon: logo ? new Image({ url: logo, mediaType: imageType(logo.href) }) : null,
    image: banner ? new Image({ url: banner, mediaType: imageType(banner.href) }) : null,
    attachments: [
      new PropertyValue({ name: "Website", value: `<a href="${escapeHtml(site)}">${escapeHtml(hubHost(facts.origin))}</a>` }),
    ],
    manuallyApprovesFollowers: false,
    discoverable: true,
    indexable: true,
  });
}

builder
  .setActorDispatcher("/ap/{identifier}", async (ctx, identifier) => (identifier === HUB_ACTOR ? hubActor(ctx) : null))
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

/** How many posts one page of the outbox holds. */
const OUTBOX_PAGE = 20;

builder
  .setOutboxDispatcher("/ap/{identifier}/outbox", async (ctx, identifier, cursor) => {
    if (identifier !== HUB_ACTOR) return null;
    const posts = await ctx.data.store.posts(OUTBOX_PAGE + 1, cursor);
    const page = posts.slice(0, OUTBOX_PAGE);
    return {
      items: page.map((p) => createFor(ctx, p, ctx.data.facts)),
      nextCursor: posts.length > OUTBOX_PAGE ? page[page.length - 1]!.published_at : null,
    };
  })
  .setFirstCursor(() => "")
  .setCounter((ctx, identifier) => (identifier === HUB_ACTOR ? ctx.data.store.postCount() : null));

builder.setObjectDispatcher(Note, "/ap/{identifier}/posts/{id}", async (ctx, values) => {
  if (values.identifier !== HUB_ACTOR) return null;
  const post = await ctx.data.store.post(values.id);
  return post ? noteFor(ctx, post, ctx.data.facts) : null;
});

/** The hashtags in a post's text (posts.ts writes them as "#<span>Tag</span>"). */
function tagsIn(content: string): string[] {
  return [...content.matchAll(/#<span>([A-Za-z0-9]+)<\/span>/g)].map((m) => m[1]!);
}

/** A post as the Note fediverse apps show. */
export function noteFor(ctx: Context<FediverseData>, post: Post, facts: HubFacts): Note {
  const actor = ctx.getActorUri(HUB_ACTOR);
  return new Note({
    id: ctx.getObjectUri(Note, { identifier: HUB_ACTOR, id: post.id }),
    attribution: actor,
    to: PUBLIC_COLLECTION,
    cc: ctx.getFollowersUri(HUB_ACTOR),
    content: post.content,
    // The item's page, and (for a reader of the civic activity stream) the
    // activity this post announces, as an alternate. Mastodon shows the
    // text/html one. docs/FEDIVERSE.md says what a reader should match.
    urls: [
      new Link({ href: new URL(post.url), mediaType: "text/html" }),
      ...(post.activity_iri
        ? [new Link({ href: new URL(post.activity_iri), mediaType: "application/activity+json", rel: "alternate" })]
        : []),
    ],
    // The item's picture, by address (followers' servers fetch it).
    attachments: post.image_url
      ? [new Image({ url: new URL(post.image_url), mediaType: imageType(post.image_url), name: post.image_alt ?? null })]
      : [],
    // The process IRI every civic activity about this item names as its context.
    contexts: post.process_iri ? [new URL(post.process_iri)] : [],
    published: Temporal.Instant.from(new Date(post.published_at).toISOString()),
    tags: tagsIn(post.content).map((t) => new Hashtag({ name: `#${t}`, href: new URL(`${facts.origin}/`) })),
  });
}

/** An image's media type from its address, which Mastodon reads to show it; null when unknown. */
export function imageType(url: string): string | null {
  const ext = /\.([a-z0-9]+)(?:$|[?#])/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
  return ext ? (types[ext] ?? null) : null;
}

/** The Create activity that delivers a post. */
export function createFor(ctx: Context<FediverseData>, post: Post, facts: HubFacts): Create {
  const note = noteFor(ctx, post, facts);
  return new Create({
    id: new URL(`${note.id!.href}#create`),
    actor: ctx.getActorUri(HUB_ACTOR),
    to: PUBLIC_COLLECTION,
    cc: ctx.getFollowersUri(HUB_ACTOR),
    object: note,
    published: note.published,
  });
}

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
    if (isBlocked(follow.actorId.hostname, ctx.data.blocked)) return;
    const follower = await follow.getActor(ctx);
    if (!isActor(follower) || !follower.id || follower.id.href !== follow.actorId.href) return;
    const inbox = follower.inboxId;
    const shared = follower.endpoints?.sharedInbox ?? null;
    // Delivered to later from the job: https only (limits.ts).
    if (!inbox || !deliverable(inbox.href) || (shared && !deliverable(shared.href))) return;
    const store = ctx.data.store;
    if (!(await store.isFollower(follower.id.href)) && (await store.followerCount()) >= FOLLOWER_CEILING) {
      await ctx.sendActivity(
        { identifier: HUB_ACTOR },
        follower,
        new Reject({
          id: new URL(`#rejects/${crypto.randomUUID()}`, ctx.getActorUri(HUB_ACTOR)),
          actor: ctx.getActorUri(HUB_ACTOR),
          object: follow,
        }),
      );
      return;
    }
    await store.addFollower({
      actor_uri: follower.id.href,
      inbox_url: inbox.href,
      shared_inbox_url: shared?.href ?? null,
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
  /**
   * Fedify's working memory: the hub's database (kv.ts), which reads the hub
   * in scope at each call, so one store serves every hub.
   */
  kv: KvStore;
  /** Tests only: reach servers on private and loopback addresses. */
  allowPrivateAddress?: boolean;
}

const built = new Map<string, Promise<Federation<FediverseData>>>();

/** The hub at `origin`'s federation, built once per instance. */
export function federationFor(origin: string, settings: FederationSettings): Promise<Federation<FediverseData>> {
  const key = `${origin}|${settings.allowPrivateAddress ? "private" : "public"}`;
  let f = built.get(key);
  if (!f) {
    f = builder.build({
      kv: settings.kv,
      // Handles name the hostname alone, even where a development origin has a port.
      origin: { handleHost: hubHost(origin), webOrigin: origin },
      allowPrivateAddress: settings.allowPrivateAddress === true,
      userAgent: { software: "CivicHub/0.1.0", url: new URL(`${origin}/`) },
    });
    built.set(key, f);
  }
  return f;
}
