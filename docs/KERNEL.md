# The Mosaic Space Kernel

What the kernel is, where its edge runs in this repository today, the rules that keep it a kernel, and the steps that
lift it out into its own repository. Read this before changing anything under `src/`, `kit/` or `packages/` that
touches the edge between them. Decision record: ADR-020 (mono repo, `decisions/020-mosaic-space-kernel.md`).

Sources this page condenses (read them for the reasoning): the Space Engine Kernel Model (Sep 2) and the Malleable
Substrate memo (Aug), in Mosaic Ecosystem Strategy; the July profile framework and boundary audit
(`mosaic-docs/canon/profile-framework.md`, `mosaic-docs/audit/boundary-audit.md`); "Mosaic Space Kernel: Rationale and
Extraction Plan" (Nov 15) and "Plugin Dependencies Strategy" (Nov 17), both Claude Docs; "Identity for Mosaic spaces:
draft approach" (Nov 13, Google Doc); ADR-009 to ADR-019 in this repository's history.

## 1. What it is

**One kernel, many space types.** Every Mosaic space (a Civic Hub, a representative's space, a club, a family, a
newsroom) runs on the same kernel. The kernel is small on purpose. It does three things: **identity** (sign-in,
accounts, who belongs to a space, member and space DIDs), **security** (permission checks, the audit log, what each
plugin may touch) and **interoperability** (the public record, the wire format other servers read, and federation:
ActivityPub now, AT Protocol and others later). To do them it also runs the plugin system and the SDK plugins are
built with, and the shared services every plugin needs: the settings store, storage, export, scheduled jobs, mail
transport and the search index. It is not a space type and it carries no field's words.

Like the Linux kernel (a metaphor, Adam, Nov 19): a small core with a stable interface, and everything people see
built on top of it. A distribution such as Ubuntu decides what comes installed; here that is the space type. Unlike
Linux, our kernel also owns how spaces talk to each other, and it keeps no drivers inside: features are plugins.

| Term | Meaning | Example |
| --- | --- | --- |
| Kernel | The shared core above. One codebase, stewarded by Mosaic. Replaces "space engine". | `mosaic-kernel` (after step 5) |
| Engine | A complete implementation that can run spaces: Mosaic's is the kernel plus plugins. Spaces are portable between engines. | Mosaic's engine |
| Profile | One field of work's words, roles, credential types and stricter rules, bound to the kernel. A document for people plus a small file the software reads. Shared by every space type in that field. | the civic profile |
| Space type | A starter kit: one profile, and for each plugin whether it is required, on by default or off by default; default settings; which samples a new space starts with. Consulted at a space's birth. | Civic Hub |
| Space | One running instance, configured freely by its admins after birth. | Floyd Civic Hub |
| Plugin | Anything in the plugin registry. Kinds: **process** (votes, events), **feature** (pinning, digests, Activity, Fediverse), **identity** (sign-in methods, credential exchange). A space's admins turn it on or off, unless its space type requires it. | Events |

The specs and the conformance suite are the kernel's constitution: they make it the reference implementation of an
open standard, not a proprietary centre, so a second engine that passes the suite is as good as ours.

## 2. Rules

1. **Plugins depend on the kernel, never on each other.** A plugin talks to the kernel's services and events. It
   never imports another plugin's code or reads its tables. When two plugins seem to need each other, in order:
   merge them; move the shared piece into the kernel; listen for an event; an optional enhancement (`enhancedBy`);
   last, a declared `requires` (one level deep, a plain `why` shown to admins).
2. **The kernel never names a plugin.** No `isPluginEnabledSync("brief")`, no import of a package. The kernel emits
   events ("a process closed") and asks for contributions plugins register.
3. **Every combination works.** Switching any plugin off leaves every other plugin working, possibly with less.
   Every process plugin shows its complete outcome on its own closed page with Briefs off (Adam, 2026-11-17).
4. **Words are free, meanings are fixed.** Kernel and plugin code use neutral words. A profile renames them; it never
   invents a new kind of thing or changes what one means. Anything a profile adds names the kernel thing it maps to.
5. **If it can be a plugin, it is one** (Adam, Nov 19; replaces the Nov 17 kernel test). The kernel holds only
   what identity, security and interoperability need, and the shared services plugins are built on. Everything else a
   person sees and uses (beyond signing in and the settings shell) is a plugin, even when nearly every space wants it. When in doubt, it is a plugin. The test:
   could a space of some type reasonably run without it? Then it is a plugin.
   - **The kernel offers services; plugins offer features.** Where a feature needs something every plugin shares,
     the shared part is a kernel service and the feature is a plugin: the search index is the kernel's and the
     search page a plugin; who belongs to a space is the kernel's and the Members page a plugin; the lists of what
     is waiting (review, feedback, the waiting list) are the kernel's and the admin's daily email a plugin.
   - **Settings are a sign.** Something with its own settings and screens is almost always a plugin.
   - **No space must have admins.** The kernel always knows who may change what (that is security), but a space type
     may give every member every role, as a peer group would. Admin features are plugins.
6. **Required plugins are still plugins.** A space type lists each plugin as **required** (on, and its admins cannot
   turn it off), **on by default** or **off by default**. A plugin a space type cannot carry its name without is
   required there, not moved into the kernel; another space type may leave it out. No plugin is required everywhere:
   if every space truly needs it, it is a kernel service.
7. **The public record only grows.** Identifiers already on the wire (`civic.vote`, activity and process addresses)
   never change. Wire changes only add fields; readers ignore fields they don't know. A breaking change gets a new
   version and the old form is served through a support window.
8. **Versioned surfaces.** The plugin SDK and each kernel service carry a semver version. 1.x to 1.y is always safe;
   2.0 breaks something, is announced, and the old surface keeps working through the support window.

## 3. Neutral roles and words

Kernel roles: **member**, **moderator**, **admin**, and **accountable** (a person who holds a public role and answers
for it: the civic profile calls them "official"; a club might say "coach"). Profiles name them; they cannot add a
role the kernel does not know.

Kernel terms (the terms service, `term("member", n)`; resolved space setting, then the profile's word for the space's
kind, then the profile's word, then the kernel's neutral word): `member`, `accountable`, `space`. `group` and
`outcome` are planned and join when two plugins need them. Add a term only when two plugins need it.

Built in step 2 (Nov 17): the roles, terms and resolution are `src/shared/spaceProfile.ts` (kernel, pure, shared by
server and UI); the civic profile is `spaces/civic/profile.ts` (moved there in step 4), hung on the Civic Hub space type
(`spaces/civic/type.ts`, `profile`). Packages read words through SDK v1's `term()` (also `hubContext().term`,
and `useSpace().term` on a page). A process descriptor writes `member` and `accountable` in `callers` and
`publish_at_once`, and `creation.member`; `resident`, `official` and `creation.resident` are the names before step
2, still read (`namesRole`, `memberCreation`) until SDK 2.0. The kernel's caller is `"member"` (`ActionCaller`).
There is no moderator grant yet: admins moderate, and the role is named so a profile can call it something.

The civic profile file (step 2) starts with only: the space noun and plural, the name for each kernel role, and the
terms above. Credential types join it with identity phase 3. A field is added only when two space types need it or a
screen cannot be written without it.

## 4. Where the edge runs today

| Layer | In this repository | After step 5 |
| --- | --- | --- |
| Kernel | `src/` (ADR-012's engine directories), `kit/` (SDK, conformance), `ui/src/kit/` and the host components plugins use | `mosaic-kernel` packages |
| Hosting | `src/hosting/`, `api/`, `vercel.json`, `supabase/config.toml` | stays with each deployment |
| Platform | `mosaic-console` (its own repo since Nov 11) | unchanged |
| General plugins | `packages/civic.*`, `features/*` | `mosaic-kernel/plugins/` |
| Civic space type | `spaces/civic/` (its record, profile, palette, sample content and development seed; `config/plugins.json`'s `"space"` picks it), civic words and modules still inside `src/` (below) | `civic-hub`: the civic profile, civic-only plugins, branding, hosting |

Still civic or plugin-shaped inside `src/`, to be sorted in step 3:

| Module | Goes to |
| --- | --- |
| `civic.auth`, `civic.review`, `civic.drafts`, `civic.process_links`, `civic.input`, `civic.link_preview` | kernel |
| `civic.search` | split, done (Nov 19): the index every plugin's items go into, and one query over it, stay the kernel's (`src/modules/civic.search/`, `src/services/kernelSearch.ts`, SDK `search.query`; a link's typeahead reads it with Search off). The Search page, `GET /search` and the top bar's box are the feature plugin `features/search`, drawn through the UI slot `navTool` |
| `civic.feedback` | feature plugin, done (Nov 19; was kernel): `features/feedback`, its own table `feedback_submissions`, with an off switch. The kernel keeps the provider's inbox (`src/services/providerInbox.ts`, SDK `providerInbox`: a hub's line to Civic.Social; an admin's "Contact Civic.Social" uses it with Feedback off) and each admin's "new since you last looked" count, which a feature asks for by naming a queue (`FeatureServer.queues`; its line in the admin digest comes from the same entry; migration `20261119210000` carries each admin's Feedback cursor over). Its pages and links draw through the UI slots `spaceLink` (the top-bar button, the sidebar, drawer and footer links, the welcome pointers) and `adminTab.queue` |
| Members (the member count and faces, the Members page) | split, done (Nov 19): who belongs to a space, the person's own "hide me" switch and "Share this hub" stay the kernel's (`src/services/members.ts`, SDK `membership`; `POST /members/invites`). The count and faces on Home, the Members page and its section, the About card's count, the threshold and the hidden members list in Settings → People are the feature plugin `features/members`, drawn through the UI slots `section`, `homeBlock`, `aboutLine`, `accountPanel` and `peopleSection`, its section from its manifest's `section` and what its UI needs first from `FeatureServer.hubConfig` (GET /hub-config `features.members`). `GET /api/aside` is gone: its one fact was the member count |
| `civic.digest` | done (Nov 19): a feature plugin, `features/digest/` (its job, assembly and formatting; it reads the hub through the SDK). Its signed unsubscribe links are the kernel's, since notices sign theirs the same way: `src/services/unsubscribe.ts` (moved, Nov 19) |
| `civic.admin_digest` | feature plugin, done (Nov 19; was kernel): `features/admin_digest`, the admin's daily email, its job and its own table `admin_digest_marks` (where the last email covered up to). The kernel keeps the counting, `src/modules/civic.admin_waiting/` (SDK `adminWindow(since, until)`: reviews, the packages' and features' queues, edits, the waitlist, job problems, and the features' `digestLines` notes). A space without admins leaves the plugin off |
| `civic.assistant` | split: the Code of Conduct check stays in the kernel (moderation, `src/services/kernelCodeOfConduct.ts`); the drafting assistant (its chat, prompts and suggestions) becomes a feature plugin. **Done 2026-11-19:** `features/assistant/`; the check's AI side is `src/services/codeOfConductAi.ts`, the shared response parsing `src/services/assistantResponse.ts`, the types `src/models/assistant.ts`; `GET /assistant/:type/config` stays a kernel route |
| `src/jobs/newsSync.ts`, `src/modules/civic.news_sync/` | done (Nov 18): News Sync is its own plugin (Adam, Nov 18), not part of Announcements, and works with Announcements off. Its job, feed reading and News page live in `packages/civic.news_sync/` (0.2.0, on SDK v1) |
| Pinning (Admin → Pinned, the Pin button on every item's page, the Pinned card, the urgent line) | feature plugin, done (Nov 19; was kernel): `features/pinning`, its own table `process_pins`. Pin any item, whatever its plugin. Its setting says who may pin (`plugin.pinning.who`: admins, the default, or every member). A pin can be marked urgent, which replaces Announcements' own urgent (dropped, Adam Nov 19; migration `20261119200000` carries urgent announcements over as urgent pins). It reads items through the kernel's items service (SDK `items`) and draws through three generic UI slots (`itemAction`, `asideCards`, `pageTop`). No plugin contributes to the card (`PluginServer.pinnedCard` is gone) |
| `civic.receipts` | kernel (decided Nov 17, with Votes 0.4.0; `docs/kernel/SURFACE.md`): every secret-ballot type needs the same audited code, which Votes reaches through the SDK's `ballots` |
| `src/services/brief*.ts`, `src/processes/spawnBrief.ts` | done: the Briefs plugin listens for the kernel's "process closed" (`src/services/processClosed.ts`) and gets the `process.result` the kernel owns |
| `src/debug/seedDeliberationMocks.ts` | done (step 1): the Conversations plugin |

## 5. The kernel surface plugins see

A plugin imports `@civic-social/plugin-sdk` (version 1, the kernel surface; renamed `@mosaic/...` at step 5),
`/manifest`, `/ui`, its own files and its peer dependencies. The packages this repository ships still import the wide
version 0 (`/first-party`); step 1 moves each onto version 1. `docs/kernel/SURFACE.md` lists every version 0 name the
packages use and decides each one: a kernel service version 1 gains, plugin code that moves out of `src/`, or a
coupling an event replaces.

## 6. Versions, updates, compatibility

- The kernel repo releases numbered versions. A space type's repo depends on one (`"@mosaic/kernel": "^1.4.0"`).
- Before a release, the kernel runs Civic Hub's tests against itself. A bot opens an update pull request in each space
  type's repo; its tests and the kernel suite run there; merging and deploying updates every hosted space of that
  type at once. Self-hosters take the release when ready.
- A plugin declares the kernel range it works with; the loader refuses a plugin the kernel cannot satisfy.
- Plugin capability changes still wait for each space's admin (ADR-015).

## 7. Conformance

Four layers: the kernel suite (every space type passes it: sign-in, permissions, the public record, plugin loading,
export); the profile check (every word maps to a kernel term; nothing redefines one); the plugin suite run under two
profiles and with each other plugin off and every optional service empty; the space-type check (defaults and pins
load on a fresh space, which serves its public feed, discovery file and a full export). Today only the plugin suite
exists (`civic-conformance`).

## 8. Steps and status

| Step | What | Status |
| --- | --- | --- |
| 0 | This page, ADR-020, the surface inventory | done on `kernel-extraction` |
| 1 | The eight first-party plugins onto SDK v1 and the kit (no imports of hub pages or engine internals) | SDK v1: done for all eight (Nov 17). Pages on the kit: not started (`MOVED_HUB_PAGES`) |
| 2 | Neutral roles and terms; the civic profile file | done (Nov 17): `src/shared/spaceProfile.ts`, `src/shared/profiles/civic.ts`, `term()`; packages move their descriptors to `member`/`accountable` at their next release |
| 3 | Sort the civic modules (table above); replace the kernel's checks of plugins by name with events | under way (Nov 17): the kernel's `process.closed` event (Briefs listens; the kernel no longer makes briefs), and package contributions in place of five name checks. Then a type's own closed line for the digest (`resultLine`), a package's own check of its settings (`checkSetting`), and the kernel's `/process/:id` link (`ui/src/pages/ProcessLink.tsx`). Then what a package adds to the kernel's pages (`contributes`: the brief pointer, review queues in the admin rail, the welcome strip). Then sign-up's stop (`contributes.afterSignUp`). Then sample content: the kernel's plugin sample hook (`PluginServer.samples`, `SampleKit`; Word clouds seeds its own), and the Civic Hub's curated samples and development seed moved out of the kernel into the space type layer (`spaces/civic/`, named in `config/space.ts`). Then News Sync into its own package (Nov 18), which leaves no engine file reaching into a package. Then pinning phase 2 (Nov 18): pins in the hub's own table, and Announcements' urgent items reach the Pinned card through `PluginServer.pinnedCard`. Then the modules (Nov 19): the resident digest and the drafting assistant are feature packages. Then the feed's filters (Nov 19): a type's card rule names its own surface, and a type builds a card from its payload (`fromPayload`); Announcements, News Sync and Meeting summaries add their own filter pills (`feedFilter` on their UI modules), and News Sync words its card and owns its settings panel. The kernel names none of them. Then the colour and kind vocabulary (Nov 19): the Civic Hub's colour families, card kinds and digest sections are its palette, `spaces/civic/palette.ts`, named in `config/spacePalette.ts` and read only by `src/shared/spacePalette.ts`; the feed, theme and digest read it, and their orders and colours are unchanged. Left for step 4: a few kernel words that name civic plugins (settings search, plugin setup hints) |
| 4 | Space types as data (profile, defaults, pins); the deployment picks its type from a setting | under way (Nov 19): the palette's colours (`--type-<key>-*` and the older `--pill-<kind>-*`, light and dark) are `spaces/civic/palette.css`, loaded through `config/spacePalette.css` right after `theme.css`; the built CSS is unchanged. The kernel keeps `--type-generic-*` and `--pill-vote-*` (the general control accent). Then plugin settings' notes, search words and "needs setup" rules moved into the packages' manifests (`pluginSection.fields[].help`, `words`, `search`, `setup`). Then the hub features' entries: a feature package's is its manifest's `pluginSection`, and `src/shared/hubFeatures.ts` lists only the kernel's own. Then plugin events in the Install confirmation's words (`eventWords`). Then the space type as a setting: one line in `config/plugins.json` (`"space": "spaces/civic"`, or null), from which `plugins:sync` writes the four `config/space*` files; the Civic Hub's record and profile moved to `spaces/civic/type.ts` and `profile.ts`, and the kernel has a neutral record for a deployment with none. Then (Nov 19) the new rule 5: the space type's plugin lists (required, on or off by default) are built; Pinning is a feature plugin (done: `features/pinning`, with an urgent flag and a who-can-pin setting; Announcements' urgent label is gone); so is Feedback (done: `features/feedback`, with its off switch; the kernel keeps the provider's inbox and the queue counts); so is the admin digest (done: `features/admin_digest`; the kernel keeps the counting, `adminWindow`); so is the search page (done: `features/search`; the kernel keeps the index); so is the Members page (done: `features/members`; the kernel keeps membership, and has no features of its own now); each plugin carries its own default colours (done: manifest `colors`, light, dark and email; the nine first-party packages carry the values the Civic Hub's palette has, and the palette, listing the same keys, still wins, so nothing changes on screen; a family the palette does not list is the package's); each plugin seeds its own samples (done: `packages/<pkg>/samples.ts` for every first-party type; the words stay the space type's, `spaces/civic/sampleTemplates.ts`, out of the kernel; each plugin says which of its samples the demo refresh keeps live, what a sample is called, and how an older one is repaired; the kernel keeps the sample people and casts sample ballots). Left: Events' panel words (with its next release) |
| 5 | Split into `mosaic-kernel`, tried first on a branch (the plan: `docs/SPLIT-TRIAL.md` in that repository); rename packages `@mosaic/...` as its own step after | not started. It no longer waits for identity (Nov 24): Mosaic is not building identity phases 1 and 2 itself, but working with OpenVTC and VTI (the First Person Project) |
| 6 | The four conformance layers; kernel releases run Civic Hub's tests; update bot | not started |
| 7 | Kernel 1.0; civic-hub on it | not started |

Identity (the Nov 13 draft) belongs to the kernel: the space DID with keys, member DIDs, the credential store,
issuer and verifier, credential requirements, account linking, roles as data, the VCALM front door. Since Nov 24 the
new identity work (bring your own DID, OIDC, membership credentials) is not built in house: Mosaic works with
outside groups (OpenVTC and VTI, part of the First Person Project), and their methods arrive as identity plugins on
the kernel's seams. What `src/` has today (email sign-in, roles) moves with the kernel at step 5.
