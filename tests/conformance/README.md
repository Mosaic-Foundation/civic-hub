# Plugin conformance suite

Every process type proves it behaves as it says, by one shared set of steps.
Registering a type is enough to have it tested: `tests/api/conformance.test.ts`
calls `runConformance({ handlers: getAllHandlers() })`, and CI runs that in
both API passes (service role, minted hub tokens).

- `runConformance.ts`: the steps, one `describe` per type.
- `driver.ts`: how the steps reach a running hub (sessions, drafts, approvals,
  actions, events, moving a deadline). It has no type-specific code.
- `hostFacts.ts`: the hub's own lists that a descriptor is checked against.
- The static checks themselves are in `src/processes/descriptorCheck.ts`,
  and are also run by `tests/unit/processDescriptors.test.ts` on every push.

## What it checks, per type

1. **The descriptor is well formed and agrees with its handler.** This covers:
   - its plugin, states and transitions;
   - its events, each mapped by the activity serializer;
   - its tables, each under row-level security and in the export manifest;
   - its creation, deadline, brief and approval;
   - its tier, and any outside service.
2. **Creation.**
   - A type residents draft: Submit runs the Code of Conduct check. Flagged
     text is refused with what to fix (`findings`) and the draft is kept;
     "tell the admins" (`tell_admins: true`, an optional `note`) queues it
     once, flagged, never live at once, on a beta and a demo hub; a check
     that can't run sends the submission to an admin. Submits that arrive
     together make one review. A beta hub queues a clean submission for an
     admin; a demo hub publishes it at once.
   - A type an admin creates: the admin can create one, and a resident can't.
3. **A failed approval** leaves the submission waiting with nothing in the
   public log, and the retry writes one `created`.
4. **The actions, walked** from where approval leaves the process.
   - Each resident action is allowed to a resident, and every other action is
     refused to one (403 `admin_required`).
   - Every result is a status the action declares; outside production, the hub
     itself refuses anything else.
   - **4b.** An action declared `once_per_participant` lets one person's
     simultaneous calls through once, and refuses the rest with 409.
5. **The deadline:**
   - exactly one close, however many readers notice at once;
   - each of the close's events written once;
   - one brief, where the type makes one.
6. **Archive and restore.**
7. **The plugin switched off**, refused everywhere: the process, its actions,
   its lists, its drafts and `civic.json`. **Switched back on**, everything is
   as it was.
8. **Every event it wrote** is one it declares and has a wire mapping, and
   nothing crosses to another hub.
9. **Tier 3 only:** the hub's side of the external-service contract (plugin
   architecture §10a), through the one adapter, with the service up, down,
   slow or erroring:
   - each participant crosses the boundary under their own identifier;
   - the declared credential and identifier are honest (a shared token is
     reported, not failed);
   - the hub decides who takes part;
   - a close still happens, once, when the service is out.

Types only the hub creates (briefs, meeting summaries, the retired vote
results) get step 1, and are reported as "not walked". A brief is exercised in
use by step 5 of every type that makes one.

## What a plugin author needs to make it pass

A process type is a `ProcessHandler` (`src/processes/types.ts`) with a
`descriptor` (`src/processes/descriptor.ts`). To pass:

1. **Declare everything the handler does, and nothing it doesn't.**
   - **Actions:** every action `handleAction` accepts. For each, say:
     - who may call it (`resident`, `creator`, `admin`, `system`);
     - the statuses it runs `from`;
     - where it leaves the process (`to`; null means unchanged);
     - the events it `emits`.
   - **Payloads:** each resident action needs an `input_schema` whose
     `examples[0]` is a valid payload.
   - **Retries:** mark `retry_safe` only if the action's every effect is on the
     process row and its events. Work in other tables goes in
     `afterActionCommits`.
   - **Once only:** mark `once_per_participant` if one person may do it once,
     and refuse the second call with a `ConflictError` (409), including when
     the two calls arrive together (back that with a unique index).
   - **Events:** list every event type the type emits, from any route,
     excluding the hub's own (`HOST_EVENT_TYPES`). Each needs a mapping in the
     activity serializer, which for a third party means an extension term in
     its own namespace (activity spec §3.4).
   - **States:** list the statuses its own lifecycle uses. `pending_review` and
     `archived` belong to the hub and stay out.
2. **Say how one is made, and give an example.**
   - **Drafted by residents:** set `creation.resident.drafts` to the drafts
     path, provide `examples.draft`, and register a draft kind
     (`src/processes/draftKinds.ts`).
   - **Created by an admin:** set `creation.admin` and provide
     `examples.create` (the request body, and its path if it isn't
     `/process`).
3. **Keep your storage under the hub's rules.** Every table you own goes in
   `tables`, carries `hub_id` with forced row-level security (`HUB_TABLES`),
   and appears in the export manifest.
4. **Deadlines are the hub's to drive** (§10a.3). If the type closes at a
   deadline:
   - declare `deadline.action` (callable by `system`) and `deadline.source`,
     where the deadline lives (`state.<key>` or `<table>.<column>`);
   - implement `closeIfExpired` by calling `closeThroughDispatcher`.
   
   Don't run your own scheduler.
5. **Refuse with typed errors** (`src/errors/`): `ValidationError` 400,
   `ForbiddenError` 403, `ConflictError` 409 and so on. Anything else is a 500,
   and the suite fails on a 500.
6. **Tier 3:**
   - declare the outside service: its one adapter, the setting holding its
     address, what participants are known as there, how the hub authenticates,
     what data it keeps and how that data leaves it, and the hub routes
     residents take part through;
   - make the adapter accept an injected `fetch`, so the suite can stand a
     fake in front of it;
   - an outage must never block a close: catch the service's failure and
     close anyway.
7. **Tier 2 (sandboxed) can't run yet:** no sandbox runtime exists, and the
   static checks refuse tier 2. Until one does, third-party code enters
   production only as Tier 3 or after first-party vetting as Tier 1 (plugin
   architecture §5a).

### Running it against your plugin

Today a plugin runs inside a hub build:
1. Register its handler in `src/processes/registry.ts`.
2. Start the hub with `CIVIC_POLIS_FAKE=on` and `CIVIC_COC_FAKE=on` against
   the local stack. The fake check flags text containing `[coc-flag]` and is
   down on `[coc-down]`; the suite puts them in the example draft's
   `description`, so a drafted type needs one.
3. Run:

```bash
cd /Users/adamlake/Developer/Civic-Social-Mono/civic-hub && CIVIC_API_BASE=http://localhost:3000 npx vitest run tests/api/conformance.test.ts
```

To prove only your type, call `runConformance({ handlers: [yourHandler] })`
from a test file of your own. When plugins load from packages (audit C3), the
same call takes the loaded plugin's handlers. Nothing in the steps names a
type.

## Tier 2: what its slot will need

When a sandbox runtime exists (plugin architecture §2, §5a Stage 2), the
`tier 2` block will run steps 1 to 9 against a plugin inside it, and add:
- an emission outside the grant is refused by the runtime;
- a call to a host not in `network.egress` fails;
- the plugin sees only its granted identity claims;
- state access goes only through the host's store.

The descriptor then needs the grant (the plugin architecture's §4.1
capability block), and the hub needs to record it at install.
