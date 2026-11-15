# The Fediverse feature

The source for the docs site's Fediverse section, and the contract for software that reads a hub both directly and on
the fediverse. Code: `features/fediverse/`. Plan: `mastodon-follow-civic-hubs-plan-2026-11-12.md` (Mosaic management).

## For hub admins {#plugins-fediverse}

Settings → Plugins → **Fediverse** gives the hub an account that people follow from Mastodon and other fediverse apps.
It is off until you switch it on.

- **The handle** is the first part of the hub's address, then the address: `@floyd@floyd.civic.social`. The panel shows
  it, with how many accounts follow the hub and how many posts it has made.
- **What it posts:** something opening (a vote, proposal, project, word cloud, conversation, event or announcement)
  and something decided (a vote's results, a conversation's outcome, a brief). Each post names the item, links to its
  page here, and carries hashtags. It never names who started it or who took part, and never shows numbers. Sample
  content is never posted. Posting starts from when you switched the feature on; nothing from before is posted.
- **How often to post** {#plugin-fediverse-post-mode}: each item as it happens, or a daily roundup (at 8 in the
  morning, on days with something new) or a weekly one (Mondays). A roundup lists the first five items and links to a
  page here with all of them.
- **Extra hashtags** {#plugin-fediverse-hashtags}: added to every post, besides #CivicHub and one from the hub's name.
- **Blocked servers** {#plugin-fediverse-blocked-servers}: one per line. Accounts on them can't follow the hub and
  nothing is sent to them. A domain blocks every server under it.
- **Post now** posts and delivers anything waiting at once, instead of at the next ten-minute run.
- **Admin → Activity** has a Fediverse card: followers now, and new followers in the period. Followers are not
  residents and are not counted in the participation numbers.

**What comes back.** Replies to the hub's posts are kept as text, with links to any pictures or video (never the
files), and are deleted when their author deletes them; they are not shown on the hub yet. Likes and boosts are
counted once per account and post. Admin → Activity's Fediverse card shows replies, likes and boosts in the period.
None of them counts as participation, and none is shown publicly. Blocked servers' replies and reactions are ignored.

Voting and commenting happen only on the hub, by verified residents.

## Following a hub both ways

A reader can follow a hub's civic activity stream directly (`GET /events`, the Civic Activity Spec) and also follow the
hub's fediverse account, through Mastodon or its own ActivityPub client. Mosaic River is one such reader. Every
fediverse item post repeats something the stream already carries, so a reader that follows both should show each item
once. Everything below is in standard ActivityStreams fields; nothing has to be parsed out of a post's text.

**1. Which account is the hub's.** `/.well-known/civic.json` names it while the feature is on:

```json
"features": {
  "fediverse": {
    "actor": "https://floyd.civic.social/ap/hub",
    "handle": "@floyd@floyd.civic.social",
    "outbox": "https://floyd.civic.social/ap/hub/outbox",
    "repeats": "https://floyd.civic.social/events"
  }
}
```

`repeats` is the stream whose items this account's posts repeat. The actor's `url` is the hub's own origin.

**2. Which item a post is about.** Each item post is a `Create` of a `Note`, `attributedTo` the actor above, with:

| Note field | Holds | Matches, on the civic activity stream |
| --- | --- | --- |
| `context` | the process IRI, `https://<hub>/process/<id>` | every activity about that process: its `context` |
| `url` (the `Link` with `mediaType: "application/activity+json"`, `rel: "alternate"`) | the civic activity this post announces, `https://<hub>/activities/<event id>` | that activity's `id` |
| `url` (the `Link` with `mediaType: "text/html"`) | the item's page on the hub | the activity's human page (`url`) |

Match on the activity id first (it is one activity), then on `context` (the same process: a post and the stream's
activity for the same event). The process IRI is minted on the origin the event was first recorded on, so it stays the
same if the hub later moves.

**3. Roundups.** A daily or weekly roundup is one `Note` listing several items. It has no `context` and its only `url`
is the roundup's page on the hub (`/fediverse/roundups/<id>`; `GET /fediverse/posts/<id>` answers its items, each
with `process_iri` and `activity_iri`). A reader that follows the hub's stream directly has every item already and can
drop a roundup from the hub's actor outright.

**The simplest rule.** If a reader follows a hub's stream directly, every post from that hub's fediverse actor (step
1) is a repeat. Drop them, or fold them into the stream's items by step 2.

**What a post never carries.** Who acted, ballot choices, vote totals, sample content, anything not public on the hub.
