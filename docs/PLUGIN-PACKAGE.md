# A Civic Hub plugin package

This is the contract a process type meets to run on a Civic Hub (plugin session 1, ADR-014). A process type is a
**package**: a directory with a fixed shape that the hub loads from a list, checks at startup, and runs only once the
platform operator has approved exactly that code.

The packages this hub ships live in this repository under `packages/`, and every one is first-party (Tier 1, plugin
architecture spec §2). A package written outside the repository has the same shape and imports the SDK by its npm
name; **`docs/BUILD-A-PLUGIN.md`** walks an outside developer through it, with the worked example
(`examples/straw-poll/`) and the suite as a package (`kit/`; plugin session 2, ADR-015).

The word cloud (`packages/civic.wordcloud/`) is the smallest complete example. Read it beside this page.

## What a package is

```
packages/<dir>/
  package.json     name and version
  index.ts         default-exports the package (below)
  manifest.ts      what the type is: plain data, read by the server and the UI
  ui.tsx           its UI module: routes, feed cards, settings panel
  migrations/      its own SQL migrations (optional)
  …                its handler, service, store, controller, routes, whatever it needs
```

### `package.json`

```json
{ "name": "@civic-social/plugin-wordcloud", "version": "0.1.0", "private": true, "type": "module",
  "peerDependencies": { "express": "^4.22.3" } }
```

`name` is an npm name (`@scope/name`); `version` is semver. Both must equal what `index.ts` says
(`npm run plugins:sync` checks).

### `index.ts`

```ts
import type { PluginPackage } from "@civic-social/plugin-sdk/first-party";

const wordcloudPackage: PluginPackage = {
  name: "@civic-social/plugin-wordcloud",
  version: "0.1.0",
  displayName: "Word clouds",          // what the catalog and the Plugins page call it
  manifest,                             // default export of ./manifest.ts
  requires: [],                         // other packages it imports, by name
  server(host) {                        // called once, when the hub loads it
    wordcloudStore.bind(createWordcloudStore(host.db));
    return {
      handler,                          // its ProcessHandler: the type's actions
      routes: [{ path: "/wordcloud", router }],
      // adminRoutes: [{ path: "/meeting-summaries", router }],   under /admin, admins only
      // drafts: { kind, extend },      a type residents draft
      // jobs: { meeting_summary: runner },                       one per job the manifest declares
    };
  },
};
export default wordcloudPackage;
```

The hub refuses to start, naming the package, when any of these is missing or malformed, when the handler is for
another type or declares another descriptor than the manifest's, when a job has no runner (or a runner no job), when a
type residents draft gives no draft kind, or when a package it `requires` is not in the list.

Every route is mounted behind the plugin's switch (a hub that removed the plugin answers 404) and behind the loader's
verdict (a package that is not mounted answers 404 on every hub). A drafts router is mounted at the descriptor's
`creation.resident.drafts` path, before the package's other routes.

### `manifest.ts`

A `ProcessManifest` (`src/processes/manifest.ts`; ADR-009), default-exported. It is plain data: it imports only
`@civic-social/plugin-sdk/manifest` and `src/shared/`, because the UI reads it too. Beyond ADR-009's fields, a package's
manifest carries:

- **`tables[].holds`**: what each table's rows are, in plain words ("residents' one-word answers"). The Install
  confirmation says "Keep its own records on this hub: …".
- **`capabilities`**: the grant it asks for (below).

The startup check refuses a manifest without either, naming the type and the package.

### The capability grant

The plugin architecture spec's §4.1 block, with the hub's own names:

```ts
capabilities: {
  activities: { emit: ["civic.process.started", "civic.process.submission_received",
                       "civic.process.result_published", "civic.process.ended"], listen: [] },
  state: { read: ["own-process"], write: ["own-process"], tables: ["wordcloud_submissions"] },
  adapters: [],                         // any of: ai, mail, video, deliberation, objectStore, web
  network: { egress: [] },
  identity: { claims: ["participant-ref"] },
  ui: { surfaces: ["process-page", "create-page", "feed-card", "settings-panel"] },
}
```

| Field | What it means | Checked |
|---|---|---|
| `activities.emit` | The event types it emits about its own processes. Must equal the descriptor's `emits`. The hub's own lifecycle events (`HOST_EVENT_TYPES`: created, updated, removed, the review's) are the hub's and not listed. | At startup (equal to the descriptor); at the one emission path, every event, in production too. |
| `activities.listen` | Must be empty: the hub delivers no events to plugins yet. | At startup. |
| `state.tables` | Its tables, legacy ones included. Must equal the manifest's `tables`. | At startup; its store's database refuses any other table. |
| `adapters` | The outside services it calls. A Tier 3 type names the adapter its service goes through. | Its host hands out only these. |
| `network.egress` | Must be empty: a package reaches an outside service only through an adapter. | At startup. |
| `identity.claims` | `participant-ref` only: an action's `actor` is the account reference, never a name or an address. | At startup. |
| `ui.surfaces` | Where its UI module draws. | At startup (known names). |

No wildcards anywhere.

**How it is enforced.** A Tier 1 package runs in the hub's process, so this is not isolation (spec §2): it is the
hub's seams refusing what the grant does not name, plus a lint rule that keeps a package from going around them.

- **A table.** A package's store gets `host.db()`: the hub in scope's database (row-level security as for every hub
  table), refusing every table its grant does not list.
- **An adapter.** `host.adapter(name)` hands out only its granted adapters. AI goes through the hub's gate (usage
  recorded by purpose, the jobs' daily ceiling); mail through the hub's guard.
- **An event.** The emission path refuses an event about a process of the package's type whose type the grant does
  not name, before anything is stored.
- Each refusal throws `GrantRefusedError` (a 500 to the caller: the fault is the package's) and is reported through
  the errors adapter as `plugin.grant.table`, `plugin.grant.adapter` or `plugin.grant.event`.
- **The import fence** (`civic/package-boundary`, eslint): a package imports the SDK by name (above), `src/shared/`, its
  own files, the packages it `requires`, Node's built-ins and the npm packages its `package.json` lists as peer dependencies (`express`; the meeting summary's `cheerio`). Nothing else of the hub: no database
  client, no adapter, no hosting layer, no console.

### The SDK

A package imports the hub by the SDK's npm name, `@civic-social/plugin-sdk` (`kit/sdk`; ADR-015, ADR-017):

| Import | Who | What |
|---|---|---|
| `@civic-social/plugin-sdk` | a package on version 1 (Events, an outside package) | the narrow surface below |
| `@civic-social/plugin-sdk/first-party` | this repository's own packages only (lint) | version 0, `src/sdk/index.ts`, every name listed: wide |
| `@civic-social/plugin-sdk/manifest` | every package's `manifest.ts` | `defineDescriptor`, `defineManifest`, `DEADLINE_CLOSE_INPUT` |
| `@civic-social/plugin-sdk/ui` | every package's `ui.tsx` | the UI module's types and the hub's UI kit |

**Built, with no path into the engine** (ADR-017). Compiled, the name resolves through the SDK's `package.json`
exports to its `.js` files, which read each name from the engine the hub installed before loading any package
(`src/sdk/install.ts`). `npm run sdk:build` writes them; CI checks they are current. A change to `kit/sdk/*.ts` or
to `src/sdk/index.ts`'s exports needs `npm run sdk:build` (and, for a compiled run, `npm install`).

**What version 1 lets a package do** (engine 2; each has a conformance step):

- **Edit a live process** (step 11): its handler's `editPolicy` returns `{ editable, locked_fields, admins_edit?,
  state_fields? }`; `draftFromProcess`/`syncDraftFromProcess` fill a draft from the live process; its draft kind's
  `applyLiveEdit` calls `applyEdit(processId, editor, { title, description, content?, state? })`. The hub runs the
  Code of Conduct check on the draft first (a field with a `coc: "<label>"` is read too), writes at the row's
  version, records `civic.process.updated`, then calls `onEdited(process, changes, editor)`.
- **Run work after the action commits** (step 12): `afterActionCommits(fn)`. An action whose own-table writes all
  wait for the commit may declare `retry_safe: true`.
- **Show who did something** (step 13): `namesFor(req, process or its id, accounts)` answers names under the
  process's disclosure policy (public: everyone; members: signed-in members; anonymous: admins only), never an
  account; null when this reader is shown none.
- **Declare its own statuses** (step 14): manifest `statuses: { declared: [{ id, label, hub }], of(process) }`.
  Read models carry `type_status`; the descriptor and the wire keep the hub's status.
- **Declare its own feed card** (step 15): manifest `feed.kinds: [{ kind, color: { key, fg, bg, label }, digest:
  { section, heading, summary? } }]`; its `feed.cards` rules use the kind and colour key.
- **Be called by an official** (step 16): the descriptor caller `official` (a resident holding a public office, as
  the seam answers it), and `creation.resident.publish_at_once: ["official"]` for a type whose officials publish
  without review.
- **Look like the hub** (step 17): its pages draw with `@civic-social/plugin-sdk/ui` (`Button`, `Field`,
  `TextInput`, `TextArea`, `Select`, `DateTimeInput`, `DraftShell`). Text on a `--color-primary` fill is
  `--color-primary-text`, never `--color-primary-ink`.
- **Declare a withdrawal** (step 10): `participation.withdrawal`, acts that are not taking part (taking back
  "going"), counted as nothing.

**Added by Events 2 (2026-10-28), each with a conformance step:**

- **Take an image from its residents** (step 18): manifest `uploads: { images: true }` with `objectStore` in its
  grant. Its pages post one file (`file`, multipart) to `POST /api/upload/process-image/<its type>`; the hub checks
  it as it checks post images (JPEG, PNG, WebP or GIF, 200 to 4000 px, at most 4 MB), stores it under
  `<hub>/types/<type>/` and answers `{ url, width, height, mime }`. The type keeps the URL (and should refuse one
  outside its folder). A type that declares nothing is refused the route.
- **Tell people** (step 19): `notify(processId, accounts, { subject, text })` with `mail` in its grant. The hub
  looks up the addresses (the package never sees one), skips accounts of other hubs, unverified addresses and
  people who unsubscribed from the hub's email, sends each one their own message through its mode guard (a demo
  or beta hub holds back whom it may not write to), puts the hub's name in the subject and a link to the process's
  own page, and answers `{ sent, held_back, skipped, failed }`. Call it after the action commits.
- **Know the hub in scope** (step 20): `hubContext()` answers `{ name, baseUrl, timeZone }`, read per call;
  `identity.timezone` is public at `/api/hub-config` for its pages. Its code names no time zone and no hub's
  address.
- **Use another vocabulary's terms on the wire** (step 8): `wireObject.contexts` declares the JSON-LD prefixes and
  terms for every lifted property that is not AS2's (`{ mz: "https://mobilizon.org/ns#", timezone: { "@id":
  "mz:timezone" } }`); the document's `@context` carries the ones its object uses. Every term on a wire object is
  AS2's or defined there.
- **Enter a time in another zone** (the UI kit): `DateTimeInput`'s `timeZone` (an IANA name) shows and reads the
  wall clock of that zone, right across a change of clocks.

### One folder: what the manifest declares instead of the hub's lists

A new type joins no file outside its folder (ADR-017; `tests/unit/typeFromFolder.test.ts`):

- **`tables[].sample`**, what each table is to sample content: `{ child: [columns], participation: { user, kind,
  nouns } }` (a person's act, counted in the removal warning in those nouns), `{ child, notParticipation: "why" }`,
  or `{ notContent: "why" }`.
- **`pluginSection.help: { text, page, anchor, pending? }`**, its Plugins panel's "?" note; `npm run plugins:sync`
  writes it into `src/shared/helpRegistry.json`.
- **`detailPath`** also gives its share-card route: `plugins:sync` keeps `vercel.json`'s `/api/og` block equal to
  the types' page paths.
- **`feed.kinds`** and **`statuses`**, above; a `wireObject` type's card events are read back by the feed from its
  manifest.
- **`legacyTypes`**: a retired type it carries (the brief carries vote results): their stored events keep their
  disclosure, public fields, card and count.

Run `npm run plugins:sync` after adding or changing a package; CI fails when what it writes is stale.

`host.allows(adapter)` says whether the hub in scope lets the package use an adapter: in its grant, and in the grant
that hub's admin approved (versions, below). A package asks before using what a newer version added, and does
without it on a hub that has not updated.

### `ui.tsx`

The type's UI module (ADR-009's registry entry, `ui/src/processes/types.ts`), default-exported: its routes, its feed
kinds' rendering, its plugin's settings panel, its default link relation. Its pages are the hub's (`ui/src/pages/`)
for now, so it imports from `../../ui/src/`. The UI resolves `react` and the router to the hub's own copy.

### `migrations/`

Files named `<14-digit timestamp>_<words>.sql`. `npm run plugins:sync` copies each byte for byte to
`supabase/migrations/<timestamp>_pkg_<dir>__<words>.sql`, where the database CLI applies it in timestamp order with
the hub's own, migrations before code as every release does. A new table carries `hub_id` and calls
`SELECT public._civic_apply_hub_policy('public.<table>')`; the RLS catalog test and the leak harness fail on one that
does not. It is granted to `authenticated` and `service_role` in the same migration, inside a `pg_roles` check
(`docs/BUILD-A-PLUGIN.md` shows it); `catalog:add` and `civic-conformance` refuse a table made without the grant. The hub's own packages have no migrations of their own yet: their tables' migrations are applied history on
every database and stay where they are.

### Conformance inputs

The descriptor's `examples` (`draft` for a type residents draft, `create` for one an admin creates): the conformance
suite drives the type with them and nothing type-specific (`tests/conformance/README.md`).

## How a package gets onto a hub

1. **The configured list.** `config/plugins.json` names the packages a deployment loads, in order. It is the hosting
   layer's file: the engine never names a package. `npm run plugins:sync` writes it out as three static import lists
   (`config/plugins/manifests.ts`, `server.ts`, `ui.ts`), because the server's and the UI's bundlers follow only
   static imports. CI fails when they are stale.
2. **The catalog entry.** `npm run catalog:add -- packages/<dir>` checks the package's shape, hashes its files, refuses
   a migration that is not additive or makes a table without granting it, starts a throwaway hub on the local stack with the package mounted unverified
   (`CIVIC_PLUGINS_UNVERIFIED`, development only), runs the conformance suite against its type alone, and on green
   writes a catalog entry as a migration: `supabase/migrations/<now>_catalog_<dir>_<version>.sql`, status `pending`,
   unsigned, with the hash, the grant and the run. `--required` writes it marked required; `--no-auto-install`, as one
   a new hub does not get. A submitted package outside `packages/` is proven through the packed suite, as its
   developer proved it.
3. **Approval.** The entry reaches each deployment with its migrations. The operator approves it in the console
   (Plugins: a fresh code, an audit row), which **signs** it with the deployment's catalog key
   (`CIVIC_CATALOG_SIGNING_KEY`; ADR-015) over (package, version, hash, grant). "Sign approved entries" signs the rows
   approved before signatures, and every row again after a key rotation. On the local stack and in CI,
   `scripts/catalog-approve-local.ts` approves and signs as the local operator (the committed test key, which every
   deployment refuses).
4. **Mounting.** At startup each server hashes each package's files (`src/plugins/hash.ts`) and mounts a package only
   when an approved catalog row records its name, version and that exact hash, its manifest asks for nothing beyond
   the grant that row recorded, and the row's signature verifies (`CIVIC_CATALOG_SIGNATURES=required`; while it is
   `transition`, a row without a signature still mounts on its hash, and a signed one must verify). The same rule on
   every deployment. Anything else, a package whose code changed after its approval included, is not mounted: its
   types read as switched off on every hub, it is reported (`plugin.unmounted`), `/health` lists it (and stays "ok"),
   and the console's dashboard shows the hubs left without it. Approvals are read again every minute.
5. **Install.** A hub admin installs the plugin on the hub's Plugins page, which shows what it will be able to do in
   plain words; the hub records the version and the grant (`hub_plugins`). A new hub gets every approved package.
   Remove has two modes: **Stop now** (what switching a plugin off always did: nothing is deleted, installing again
   brings everything back) and **Wind down** (nothing new can be started, what is open runs to its close, and the
   close job switches it off when the last one closes; offered for types that close at a deadline).
6. **Update** (ADR-015). A deployment runs one version of each package for every hub; its code changes reach every
   hub at once. Each hub records the version whose grant its admin approved, and its seams hold the package to that
   grant. When the deployment runs a newer version, the Plugins page says an update is available and what it changes
   in the grant, in the same words; Update records the new version and grant. A version the operator marks
   **required** in the console is recorded on every hub, with a notice on its Plugins page.

## Working on a package locally

A change to any file of a package changes its hash, so it is not mounted until a catalog entry records the new one.
While you work, start the server with `CIVIC_PLUGINS_UNVERIFIED=on` (refused on every deployment). When it is done,
run `npm run catalog:add -- packages/<dir>`, commit the entry with the change, and approve it in the console of each
deployment after its migrations are applied, before the code (`RUNBOOK-release.md`).

## Not yet

- **Tier 2**, a sandboxed runtime for code the operator did not write. Until it exists, third-party code reaches
  production only as Tier 3 or after first-party vetting as Tier 1 (spec §5a).
- **Publishing** `@civic-social/plugin-sdk` and `@civic-social/plugin-conformance` to npm, and **loading from a
  registry** rather than a configured list.
- **Narrowing a grant at install**, and an old version's behaviour pinned per hub.
- **The shipped packages on SDK version 1** (they import version 0 by name, and the hub's UI pages), and feature
  packages on the SDK by name.
