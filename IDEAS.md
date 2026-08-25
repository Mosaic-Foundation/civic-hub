# Ideas — Civic Hub Future Capabilities

Long-horizon thinking that isn't yet ready to become a GitHub issue. Use this
file for fuzzy ideas, exploratory features, and "what if…" thinking.

When an idea crystallizes into well-scoped, actionable work, **graduate it to
a GitHub Issue** (and optionally leave a stub here pointing at the issue, or
delete the entry).

**How this fits with the other tracking files:**

- **`HANDOFF.md`** (repo root of `Civic-Social-Mono`) — session-by-session
  build log. Each slice has short-term follow-ups at the bottom.
- **GitHub Issues** (on `creatinglake/civic-hub`) — concrete, actionable work
  items. Things you'd hand to a collaborator.
- **`IDEAS.md`** (this file, in `civic-hub`) — fuzzy, long-horizon, or
  cross-cutting thinking.

---

## Protocol / Federation

- ActivityPub federation — inbox/outbox for cross-hub event distribution
  (Phase 3+ per CLAUDE.md).
- **Process relationships on the wire — do this WITH the AS2 bridge, not
  after.** Light process-linking shipped 2026-08-25 (`process_links`:
  continues / references / implements). No spec covers relationships between
  processes, so links currently ride the wire as an opaque `hub:payload` blob
  on `civic.process.updated` rather than as something a federated consumer can
  follow. AS2 has native homes for it — `context`, `inReplyTo`, `target`,
  `Relationship` — and civic-activity.md §9 already earmarks `process_id ->
  object.context`. Two pieces of work: (a) project process_links as a real AS2
  relationship in `src/events/activitySerializer.ts` (a wire change — goldens
  updated deliberately), and (b) decide whether civic-activity.md /
  civic-process.md should define process relationships at the protocol level.
  (b) is a design-review call. A pointer note also sits in the serializer
  header, where whoever starts the bridge will see it.
- DID-based identity and verifiable credentials (Phase 2).
- Event signing for cryptographic provenance across federated hubs.
- Credential-scoped visibility (e.g. "only verified Floyd residents can see
  this event / vote").
- Cross-hub event subscriptions — a hub can subscribe to another hub's feed
  filtered by jurisdiction or process type.

## Process Types (Plugin Model)

The process registry already supports adding new types without changing core
code. Ideas for process plugins worth exploring:

- `civic.petition` — signature-collection process with a support threshold
  and a public outcome.
- ~~`civic.announcement` — non-interactive news posts that surface in the feed
  but don't accept actions.~~ Shipped in Slice 4 (2026-04-22).
- `civic.deliberation` — structured discussion with framing prompts, before a
  vote opens.
- `civic.budget` — participatory budgeting (allocate a fixed pool across
  projects).
- `civic.townhall` — scheduled real-time event with RSVP and post-event notes.

## UI / UX

- **Theme uploader.** Hub operators upload a theme file (colors, fonts, logo,
  banner) that overrides the `:root` tokens defined in
  `ui/src/styles/theme.css`. The token architecture is already in place;
  what's missing is the upload UI and the storage model.
- **Feed filter / search UI.** The `Feed` component already accepts a
  `filter` prop as an extension point, so this is additive.
- **Live relative timestamps.** Make "5 days ago" tick without a reload.
- **Visual harmonization** between `civic-hub/ui/` and `citizen-dashboard/`.
  Potentially via a shared token package.
- **Process-type-specific feed posts.** When petitions and announcements
  land, the `eventToPost()` switch in `FeedPost.tsx` needs new branches for
  their post formats.

## Infrastructure / Ops

- Monitoring / error reporting (e.g. Sentry) wired to Vercel.
- Server-side pagination on `GET /events` once the event store outgrows
  client-side slicing.
- Event archival / compaction strategy for long-lived hubs.
- **Scheduled vote closure.** Today `voting_closes_at` is only checked when
  someone tries to vote after the deadline (fails with "expired") — nothing
  actually triggers the `process.close` transition, so expired votes sit in
  `active` state indefinitely with no brief spawned. Right long-term fix is
  a scheduled task (cron / Vercel cron / Supabase Edge function) that runs
  nightly, finds `civic.vote` processes past `voting_closes_at`, and closes
  them via the normal flow (which spawns the brief). For the pilot, an
  admin "Close voting" emergency button is a workaround — but the clock-
  driven path is what residents expect.

## Backend / Spec alignment

- Carry the process title in `civic.process.result_published` event data, so
  federated consumers can render result posts without calling back to the
  origin hub. Briefs already carry it; votes still don't.
- Theme consolidation — migrate legacy `--text-color` / `--primary-color`
  vars in `ui/src/index.css` to the semantic tokens in
  `ui/src/styles/theme.css`.

## Governance / Community

- Moderation tooling — admin review queue, takedown log, appeal flow.
- Jurisdiction directory — discover hubs by geography.
- Politician / official profiles tied to jurisdictions, with verified
  channels for posting responses to community votes.
- Credential issuance (residency, voter registration) as civic-issued VCs.
- **User-record roles (replaces env-var email lists).** Today admin and
  Board roles come from `CIVIC_ADMIN_EMAILS` / `CIVIC_BOARD_EMAILS`
  env vars. For the pilot that's fine — the lists are tiny. As the hub
  scales or federates, migrate to a per-user role column in the users
  table so role assignment is a DB operation (admin-editable UI) and
  doesn't require a redeploy per change.
- **Announcement retraction.** Slice 4 supports edits but not deletion
  or retraction. An announcement that was sent in error may need to be
  withdrawn transparently (emit `civic.process.retracted`, keep the
  record visible but marked "retracted", preserve edit history). Spec
  would need a new canonical event type for this.

## Protocol / Federation (further)

- **Informational `process_kind`.** Spec §5 assumes all processes
  implement Phases 0–6 with meaningful civic activity in each. Slice 4's
  `civic.announcement` skips Phases 1–5 because they don't correspond to
  anything real for an instant-publish informational post. Worth
  proposing a spec extension that formalizes three process kinds:
  participation-driven (civic.vote, civic.petition),
  derivative (civic.brief), and informational (civic.announcement), each
  with its own phase-compliance rules. Makes conformance checks clearer
  and helps federated consumers interpret incoming process descriptors.

## Observability of civic impact

- Track and surface how vote results flow back into local government
  decisions — feedback loop for "did this vote actually change anything?"
- Public audit log of official responses tied to specific votes.

## Multi-tenancy / per-hub customization

The Civic.Social vision is federated independent hubs (Floyd, Arlington,
a school board in Ohio, a state-level body in Vermont). Each new operator
needs to customize the surface — banner image, hub name, intro copy,
About content, theme accent, jurisdiction string, email subject prefix,
"Floyd County residents" wording, and so on. Today some of this lives in
env vars (`HUB_NAME`, `HUB_POSTAL_ADDRESS`, `MEETING_SOURCE_URL`,
`CIVIC_ADMIN_EMAILS`, etc.), some in the `hub_settings` table (brief
recipients, announcement-author lists), and some is hardcoded in the
codebase (banner image path, intro popup copy, About markdown,
"Floyd"-flavored strings throughout the UI, theme palette).

### Customization surface inventory

What a new operator would need to change:

- **Identity** — hub name, wordmark / logo, banner image, footer "operated
  by" tagline, color theme accent.
- **Copy** — intro popup text, About page content, jurisdiction-specific
  wording across the UI ("Floyd County residents" → whatever), email
  subject prefixes.
- **Configuration** — admin / Board emails, postal address, time zone,
  default jurisdiction string used in events (`us-va-floyd`), Resend /
  SMTP credentials.
- **Process-specific** — for meeting summaries (Slice 6): source URL,
  extraction instructions, connector id. Already env vars.
- **Legal** — Privacy / TOS / Code of Conduct. Already markdown files in
  `ui/src/content/legal/` from Slice 11; placeholders need filling in.

### Five approaches, low to high complexity

1. **Fork-and-edit.** Each operator clones the repo, edits hardcoded
   strings + env vars, deploys their own Vercel + Supabase. Federation
   across forks works fine because hubs talk via the Civic Event spec.
   De-facto path today. Cost: low (just push hardcoded stuff into env
   vars and content files). Downside: every operator needs developer
   competence.

2. **Centralized hub config object.** A single `hub.config.ts` (or
   `hub.json`) at repo root holds every customization point. New
   operators only edit that one file. Banner image still in `/public`,
   markdown content still in `ui/src/content/`. "Approach 1, made tidier."
   Cost: one focused refactor pass. Onboarding becomes much shorter.

3. **Admin-editable runtime settings.** Most non-developer-friendly
   things (hub name, banner upload, intro copy, About content, theme
   accent color) move into `hub_settings` rows in the DB. An admin
   settings UI exposes them to operators. The codebase has already
   started down this road — brief recipients and announcement-author
   lists already work this way. Cost: moderate slice. Benefit: every
   future operator's setup becomes non-developer-friendly.

4. **First-run setup wizard.** When a fresh deployment boots and
   `hub_settings` is empty, a wizard walks the operator through hub
   name, banner upload (using Supabase Storage from Slice 9), admin
   email, jurisdiction string, and an initial fill of About / intro
   content. Saves to the DB. Cost: medium slice. Onboarding for a
   non-developer becomes ~20 minutes once they have Vercel + Supabase
   accounts.

5. **True multi-tenant single deployment.** One deployment, hubs keyed
   by hostname (`floyd.civic.social`, `arlington.civic.social`, …),
   each tenant a row in a `hubs` table. Full architectural pivot.
   Months of work. Real data isolation, admin permissions across hubs,
   legal complexity (one operator vs many). Probably not — this is a
   different kind of project. Better as a separately-positioned
   "Civic.Social hosted" offering for operators who want to outsource
   infra, kept distinct from the open-source self-host story.

### Recommended ordering

- **Near term (post-launch):** Approach 2. Pull every hardcoded "Floyd"
  / "Floyd County" / banner path / intro text reference into one config
  object. Incrementally useful even before any second hub exists.
- **Medium term:** Approach 3. Build an admin settings UI for the
  most-edited items, on top of the existing `hub_settings` table.
- **Longer term, post-pilot:** Approach 4. Setup wizard. Only worth
  building once there's evidence of multiple operators wanting to spin
  up.
- **Probably not, or only as a separate offering:** Approach 5.

### Signals to watch

- Approach 1's friction starts hurting → time for Approach 2 (when
  forking and editing 12 files for each new hub becomes the bottleneck).
- Hand-walking every new operator through a Vercel deploy → time for
  Approach 4.
- Until those signals show up, the work is speculative. **In the
  meantime, anytime a hardcoded "Floyd" string is encountered while
  building a slice, push it into an env var or a content file.** By the
  time hub #2 arrives, half the refactor will already be done.

### Adjacent ideas already in this file

- "Theme uploader" (UI / UX section) — overlapping with Approach 3.
- "User-record roles" (Governance section) — overlapping with
  Approach 3 for admin/Board role management.
- These should be consolidated under whatever multi-tenancy slice
  eventually graduates from this section.

---

## Log of ideas that graduated

When an idea here becomes a GitHub issue, move the entry down here with a
link. Keeps a paper trail of what was fuzzy thinking that turned real.

- Separate Supabase projects for preview and production → [#2](https://github.com/creatinglake/civic-hub/issues/2)
- Pre-populate BriefContent.comments from civic.input at generation → shipped in Slice 3.5 (2026-04-22).
