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

**One kernel, many space types.** Every Mosaic space (a Civic Hub, a representative's space, a club, a newsroom) runs
on the same kernel. The kernel is the shared core: identity and sign-in, permissions, the public record (the one
emission path, the wire, the feed), the process runtime, the plugin runtime and its slots, settings, storage,
scheduled jobs, mail, drafting and review, export. It is not a space type and it carries no field's words.

| Term | Meaning | Example |
| --- | --- | --- |
| Kernel | The shared core above. One codebase, stewarded by Mosaic. Replaces "space engine". | `mosaic-kernel` (after step 5) |
| Engine | A complete implementation that can run spaces: Mosaic's is the kernel plus plugins. Spaces are portable between engines. | Mosaic's engine |
| Profile | One field of work's words, roles, credential types and stricter rules, bound to the kernel. A document for people plus a small file the software reads. Shared by every space type in that field. | the civic profile |
| Space type | A starter kit: one profile, default plugins, settings, pinned parts. Consulted at a space's birth. | Civic Hub |
| Space | One running instance, configured freely by its admins after birth. | Floyd Civic Hub |
| Plugin | Anything in the plugin registry an admin can turn on or off. Kinds: **process** (votes, events), **feature** (meeting summaries, Activity, Fediverse), **identity** (sign-in methods, credential exchange). | Events |

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
5. **Kernel test.** Something goes in the kernel when two or more unrelated plugins need it, it means the same thing
   in any space type once its words are swapped, and it holds member data or results people must be able to trust.
   If only some spaces want it, it is still kernel, behind a setting; a kernel service that is off returns nothing.
6. **No always-on plugins.** If no space can work without it, it is kernel. If a space type needs it to carry its
   name honestly, the space type pins it (pinning: not built yet).
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
server and UI); the civic profile is `src/shared/profiles/civic.ts`, hung on the Civic Hub space type
(`src/shared/spaceTypes.ts`, `profile`). Packages read words through SDK v1's `term()` (also `hubContext().term`,
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
| Civic space type | civic words and modules still inside `src/` (below), `src/shared/spaceTypes.ts` | `civic-hub`: the civic profile, civic-only plugins, branding, hosting |

Still civic or plugin-shaped inside `src/`, to be sorted in step 3:

| Module | Goes to |
| --- | --- |
| `civic.auth`, `civic.review`, `civic.drafts`, `civic.search`, `civic.process_links`, `civic.feedback`, `civic.input`, `civic.link_preview` | kernel |
| `civic.digest`, `civic.admin_digest`, `civic.assistant`, `src/jobs/newsSync.ts` | feature plugins (News Sync folds into Announcements) |
| `civic.receipts` | the Votes plugin |
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
| 3 | Sort the civic modules (table above); replace the kernel's checks of plugins by name with events | under way (Nov 17): the kernel's `process.closed` event (Briefs listens; the kernel no longer makes briefs), and package contributions in place of five name checks. Then a type's own closed line for the digest (`resultLine`), a package's own check of its settings (`checkSetting`), and the kernel's `/process/:id` link (`ui/src/pages/ProcessLink.tsx`). Then what a package adds to the kernel's pages (`contributes`: the brief pointer, review queues in the admin rail, the welcome strip). Then sign-up's stop (`contributes.afterSignUp`). Left: seeding, and moving the modules in the table |
| 4 | Space types as data (profile, defaults, pins); the deployment picks its type from a setting | not started |
| 5 | Split into `mosaic-kernel` (after identity phases 1 and 2 merge); rename packages `@mosaic/...` | not started |
| 6 | The four conformance layers; kernel releases run Civic Hub's tests; update bot | not started |
| 7 | Kernel 1.0; civic-hub on it | not started |

Identity (the Nov 13 draft) belongs to the kernel: the space DID with keys, member DIDs, the credential store,
issuer and verifier, credential requirements, account linking, roles as data, the VCALM front door. Identity phases
1 and 2 are built in `src/` now and move with the kernel at step 5.
