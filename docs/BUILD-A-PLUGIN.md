# Build a plugin for the Civic Hub

This guide takes you from an empty folder to a plugin that passes the Civic Hub's conformance suite, and then to
submitting it to Mosaic. You do not need the hub's source code. You need:

- **Node 22.12 or later** (24 is what the hub runs).
- **Docker**, running, and the **Supabase CLI** (`brew install supabase/tap/supabase` on a Mac): the suite runs your
  plugin on a real hub, against a real database, on your machine.

The worked example is a **straw poll**: one question, two to six options, one answer per person, closing on a date.
It is about 250 lines. Its full source is at `examples/straw-poll/` in the hub's repository
([github.com/Mosaic-Foundation/civic-hub](https://github.com/Mosaic-Foundation/civic-hub)), and every snippet below is
from it.

## What a plugin is

A Civic Hub runs **civic processes**: votes, proposals, conversations, briefs. A plugin adds a new **process type**.
The hub gives it a home: who may take part, the review queue, the public record, the feed, closing on a date,
archiving, export. Your plugin says what the type is and what its actions do.

A plugin is an npm-style package: a folder the hub loads.

```
straw-poll/
  package.json     its name and version
  index.ts         what the hub loads: the package
  manifest.ts      what the type is, as plain data
  handler.ts       what its actions do
  store.ts         the records it keeps, in its own table
  ui.tsx           its page
  migrations/      the SQL that makes its table
```

Today a plugin runs **inside the hub's own process** once Mosaic has reviewed and approved it (a *Tier 1* plugin, in
the Civic plugin architecture). That is why the review exists, and why the hub checks, every time it starts, that the
code it runs is exactly the code Mosaic approved (more under "After approval").

## 1. Start the folder

```bash
mkdir my-plugins && cd my-plugins && npm init -y && npm pkg set type=module
```

```bash
npm install @civic-social/plugin-sdk @civic-social/plugin-conformance
```

`@civic-social/plugin-sdk` is everything your plugin may import from the hub. It also carries the hub's engine, so
the conformance suite can start a hub on your machine with your plugin in it; your plugin never imports the engine.
`@civic-social/plugin-conformance` is the suite and its command, `civic-conformance`.

Then start the local database once (it keeps running until you stop Docker):

```bash
npx civic-conformance stack
```

Make your plugin's folder, `straw-poll/`, with this `package.json`:

```json
{
  "name": "@your-org/plugin-straw-poll",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "peerDependencies": { "@civic-social/plugin-sdk": "^0.1.0" }
}
```

The name needs a scope (`@your-org/`). The version is `major.minor.patch`; every change you submit gets a new one.

## 2. Say what the type is: `manifest.ts`

The manifest is plain data: the hub's server and its web pages both read it, so it imports only
`@civic-social/plugin-sdk/manifest`. It has two parts: the **descriptor** (the type's public contract: its states,
its actions, the events it writes) and the rest of the **manifest** (how the hub stores, shows and limits it).

```ts
import { DEADLINE_CLOSE_INPUT, defineDescriptor, defineManifest } from "@civic-social/plugin-sdk/manifest";

export const TYPE = "example.straw_poll";

const descriptor = defineDescriptor({
  type: TYPE,                     // "<your namespace>.<name>": lowercase, one dot
  version: "0.1",
  tier: 1,
  plugin: "straw_poll",           // the switch an admin sees on the Plugins page
  states: ["active", "closed"],
  initial_status: "active",
  actions: [
    {
      name: "answer",
      description: "Answer the poll: one of its options, once",
      callers: ["resident", "admin"],
      from: ["active"],             // the statuses it runs from
      to: null,                     // where it leaves the process: null is "unchanged"
      emits: ["civic.process.submission_received"],
      once_per_participant: true,   // the suite proves a second answer is refused
      input_schema: {
        type: "object",
        properties: { choice: { type: "string" } },
        required: ["choice"],
        examples: [{ choice: "Yes" }],   // the suite answers with examples[0]
      },
    },
    {
      name: "close",
      description: "Close the poll and publish the counts",
      callers: ["admin", "system"],      // "system": the hub's scheduler, at the deadline
      from: ["active"],
      to: "closed",
      emits: ["civic.process.ended", "civic.process.result_published"],
      retry_safe: true,                  // it changes only the process and its events
      input_schema: DEADLINE_CLOSE_INPUT, // an admin closing early gives a note
    },
  ],
  emits: ["civic.process.submission_received", "civic.process.ended", "civic.process.result_published"],
  creation: { resident: null, admin: true, system: false },
  deadline: { action: "close", source: "state.closes_at" },
  brief: false,
  tables: ["straw_poll_answers"],
  outside_services: [],
  examples: {
    create: {   // what the suite sends to make one, as an admin
      body: {
        definition: { type: TYPE, version: "0.1" },
        title: "Conformance straw poll",
        description: "A quick question.",
        state: { question: "Should the hub try this?", options: ["Yes", "No"], duration_days: 7 },
      },
    },
  },
  display: { label: "Straw poll", plural: "Straw polls", icon: "poll" },
});
```

What the fields promise, and what the suite checks:

- **`actions`**: every action your handler accepts, and no other. For each: who may call it (`resident`, `creator`,
  `admin`, `system`); the statuses it runs `from`; where it leaves the process (`to`); the events it `emits`. A
  resident action needs an `input_schema` whose first example is a valid payload. The suite calls every action as a
  resident and expects 403 for those not open to residents.
- **`retry_safe`**: only when the action's every effect is on the process and its events.
- **`once_per_participant`**: one person may do it once. Refuse a second call with a 409 (`ConflictError`), including
  two calls that arrive together: back it with a unique key in your table.
- **`emits`**: the event types your plugin writes. Use the hub's process events (`civic.process.started`,
  `.submission_received`, `.ended`, `.result_published` and the rest); the hub publishes them on its public record.
  The hub's own events (created, updated, removed, the review's) are the hub's: leave them out.
- **`states`**: the statuses your lifecycle uses. `pending_review` and `archived` are the hub's: leave them out.
- **`creation`**: who makes one. A type residents draft needs a drafts route and `examples.draft` (see
  `PLUGIN-PACKAGE.md` in the repository); the straw poll is made by an admin.
- **`deadline`**: if it closes on a date, the action that closes it (callable by `system`) and where the date is.

Then the manifest:

```ts
export const STRAW_POLL_MANIFEST = defineManifest({
  descriptor,
  color: "vote",                       // one of the hub's theme colours: vote, proposal, conversation, project,
                                       // announcement, meeting, brief, wordcloud
  detailPath: (id) => `/straw-poll/${id}`,
  requiredSchema: [{ table: "straw_poll_answers", columns: ["process_id", "user_id", "choice"], owner: TYPE }],
  tables: [{ name: "straw_poll_answers", rows: "export", key: ["process_id", "user_id"], holds: "residents' answers to straw polls, one each" }],
  jobs: [],
  pluginSection: { order: 70, name: "Straw polls", what: "A quick one-question poll that closes on a date.", fields: [] },
  activities: {},
  disclosure: "anonymous",             // who a participant's name is shown to: anonymous, members or public
  participation: {                     // what the hub's analytics counts (conformance step 10)
    participation: ["civic.process.submission_received"],
    creation: ["civic.process.created"],
    closing: ["civic.process.ended"],
    outcome: ["civic.process.result_published"],
  },
  publicPayload: { "civic.process.result_published": ["straw_poll_result"] },
  deadlineRefusal: { code: "straw_poll_closed", message: "This straw poll has closed." },
  capabilities: { /* the grant: next section */ },
});

export default STRAW_POLL_MANIFEST;
```

- **`tables`**: every table you keep, with what its rows are **in plain words** (`holds`): a hub admin reads it before
  installing your plugin. `rows: "export"` puts its rows in the hub's data export.
- **`publicPayload`**: per event type, the fields of your event's `data` the public record may carry. Anything else in
  `data` stays with the hub's admins.
- **`disclosure`**: whether anyone sees who took part. A straw poll publishes counts, never names.
- **`participation`**: which of your events record a resident taking part (an answer), and which create, close and
  record the outcome of one of your processes. The hub counts participation from this alone, in counts that never name
  anyone, so your type is counted from the day it is installed. If residents never take part in it, say `"none"`;
  if they take part outside the hub and another type records their total, say `"elsewhere"`.

### The grant: `capabilities`

The grant is what your plugin may touch. The hub enforces it, and a hub admin reads it, in plain words, before
installing your plugin.

```ts
capabilities: {
  activities: { emit: ["civic.process.submission_received", "civic.process.ended", "civic.process.result_published"], listen: [] },
  state: { read: ["own-process"], write: ["own-process"], tables: ["straw_poll_answers"] },
  adapters: [],
  network: { egress: [] },
  identity: { claims: ["participant-ref"] },
  ui: { surfaces: ["process-page"] },
},
```

| Field | What it means | What the admin reads |
|---|---|---|
| `activities.emit` | The events it writes. Must equal the descriptor's `emits`. | "Add entries to the hub's public record about its own items: when an answer comes in, one closes and it publishes a result." |
| `activities.listen` | Must be empty: the hub delivers no events to plugins yet. | |
| `state.tables` | Its tables. Must equal the manifest's `tables`. | "Keep its own records on this hub: residents' answers to straw polls, one each. It cannot read or change anything else the hub keeps." |
| `adapters` | The outside services it uses, through the hub: `ai`, `mail`, `video`, `deliberation`, `objectStore`, `web`. Empty for the straw poll. | "Use the hub's AI service…", or, when absent, "It will not be able to: Use AI. Send email." |
| `network.egress` | Must be empty: a plugin reaches an outside service only through an adapter. | "Contact any service outside this hub." (cannot) |
| `identity.claims` | `participant-ref` only: an action's actor is a reference number, never a name or an address. | "Know who takes part only by a reference number." |
| `ui.surfaces` | Where its UI draws: `process-page`, `create-page`, `feed-card`, `nav-section`, `settings-panel`. | |

No wildcards. Reaching past the grant (another table, an adapter it was not granted, an event it did not declare) is
refused with an error and reported to Mosaic, on every hub.

A hub admin may approve one version's grant and not yet the next. When a newer version asks for more (say it adds
`ai`), a hub that has not updated keeps it to what it approved: before using something a newer version added, ask
`host.allows("ai")` and do without it if the answer is no.

## 3. Keep its records: `migrations/` and `store.ts`

Your table, as a migration. Name it `<14-digit timestamp>_<words>.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.straw_poll_answers (
  hub_id     text        NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  process_id text        NOT NULL,
  user_id    text        NOT NULL,
  choice     text        NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, process_id, user_id)
);

SELECT public._civic_apply_hub_policy('public.straw_poll_answers');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.straw_poll_answers TO authenticated, service_role;
  END IF;
END $$;
```

- **`hub_id`** on every row, and the policy line, which puts the table under the hub's row-level security: one hub
  never sees another's rows. The suite fails a table without it.
- **The grant** to the hub's database roles, in the migration that makes the table, inside that role check (a
  database without them still takes the migration). A hosted database's defaults may grant it anyway; a local one
  does not, and your plugin would fail with "permission denied" on its first write. The suite refuses a table made
  without it, before anything runs, and says what to add.
- **The primary key** is what makes "one answer each" true when two answers arrive together.
- **Migrations are additive only.** Every hub on a deployment shares one database, and a hub that has not updated to
  your new version still runs on it. Add tables, columns (nullable or with a default), indexes, comments; never drop,
  rename, rewrite rows, or change a column. The suite refuses a migration that does (before it runs anything).

The store reaches the table only through the database the hub hands your plugin (its granted tables only):

```ts
import { HubDbError, readAll, storeSlot, type GrantedDb } from "@civic-social/plugin-sdk";

export const strawPollStore = storeSlot<StrawPollStore>("example.straw_poll");

export function createStrawPollStore(db: () => GrantedDb): StrawPollStore {
  return {
    async insertAnswer(row) {
      try {
        await db().from("straw_poll_answers").insert(row);
        return "ok";
      } catch (err) {
        if (err instanceof HubDbError && err.code === "23505") return "duplicate";  // the primary key
        throw err;
      }
    },
    // hasAnswered, counts …
  };
}
```

`db()` is scoped to the hub the request is for. You never write `hub_id` yourself.

## 4. Do what the actions say: `handler.ts`

```ts
import { ConflictError, ValidationError, closeThroughDispatcher, emitEvent, isPastDeadline,
         type Process, type ProcessAction, type ProcessHandler } from "@civic-social/plugin-sdk";

const handler: ProcessHandler = {
  type: TYPE,
  descriptor: STRAW_POLL_MANIFEST.descriptor,
  requiredSchema: [...STRAW_POLL_MANIFEST.requiredSchema],
  detailPath: STRAW_POLL_MANIFEST.detailPath,

  initializeState(input) { /* check the question and options; set closes_at */ },

  async handleAction(process, action) {
    switch (action.type) {
      case "answer": {
        // … check the choice …
        if ((await strawPollStore.get().insertAnswer({ process_id: process.id, user_id: action.actor, choice })) === "duplicate") {
          throw new ConflictError("You have already answered this poll.", "already_answered");
        }
        await emitEvent({ event_type: "civic.process.submission_received", visibility: "restricted", data: {}, /* … */ });
        return { status: "answered" };
      }
      case "close": { /* count, set process.status = "closed", emit ended and result_published */ }
      default:
        throw new ValidationError("That action isn't supported on a straw poll.", "action_not_supported");
    }
  },

  async getReadModel(process, actor) { /* what its page reads */ },
  getSummary(process) { /* what a list shows */ },

  // Closing on a date: past it, it reads as closed at once, and the hub's scheduler closes it.
  readAsClosed(process) { /* a closed copy when past closes_at, else null */ },
  async closeIfExpired(process) {
    if (process.status !== "active" || !isPastDeadline(stateOf(process).closes_at)) return process;
    return closeThroughDispatcher(process, { type: "close", actor: "system:auto-close", payload: {} });
  },
};
```

- **Refuse with the SDK's errors**: `ValidationError` (400), `ForbiddenError` (403), `NotFoundError` (404),
  `ConflictError` (409). Anything else is a 500, and the suite fails on a 500.
- **Every event goes through `emitEvent`**, the hub's one way of writing to its public record. `visibility:
  "restricted"` keeps an event (who answered) off the public record.
- **The actor is the hub's**: `action.actor` is a reference to the account that acted, from its session. Never put
  one person's reference in what another person reads.
- **Deadlines are the hub's to drive**: don't run your own timer.

### What else a type can do (SDK v1)

None of these is required; each has a step in the suite where you use it (`docs/PLUGIN-PACKAGE.md`, "The SDK").

- **Let its creator (and admins) edit a live one**, words included: `editPolicy` on the handler, `applyLiveEdit` on
  the draft kind calling `applyEdit`, and `coc: "<label>"` on any free-text draft field others will read. The hub
  runs the Code of Conduct check on the edit.
- **Write its own tables only once the action has won:** `afterActionCommits(() => …)`, then `retry_safe: true` on
  the action.
- **Show who took part** as the hub would: `namesFor(req, processId, accounts)` in a route of its own.
- **Have words for its own statuses** (an event is scheduled, past or cancelled): manifest `statuses`.
- **Have its own feed card colour and digest section:** manifest `feed.kinds`.
- **Open an action to officials**, or let officials publish without review: the `official` caller,
  `creation.resident.publish_at_once: ["official"]`.
- **Say that an act is not taking part** (taking back "going"): `participation.withdrawal`.
- **Class its tables for sample content** and give its Plugins panel a help note: `tables[].sample`,
  `pluginSection.help`. Nothing outside your folder names your type.

`kit/conformance/fixtures/sdk-tour` in the hub's repository uses every one of these.

## 5. Tie it together: `index.ts`

```ts
import type { PluginPackage } from "@civic-social/plugin-sdk";
import manifest from "./manifest.js";
import handler from "./handler.js";
import { createStrawPollStore, strawPollStore } from "./store.js";

const strawPollPackage: PluginPackage = {
  name: "@your-org/plugin-straw-poll",   // equal to package.json's
  version: "0.1.0",                      // equal to package.json's
  displayName: "Straw polls",            // what the catalog and the Plugins page call it
  manifest,
  server(host) {                         // once, when the hub loads it
    strawPollStore.bind(createStrawPollStore(host.db));
    return { handler };                  // and its own routes, if it needs any
  },
};

export default strawPollPackage;
```

## 6. Its page: `ui.tsx`

The UI module lists your type's pages. They are your own React components, using the React the hub runs, drawn
with the hub's UI kit so they look like the hub's own pages: `Button` (primary, secondary, danger), `Field`,
`TextInput`, `TextArea`, `Select`, `DateTimeInput` (ISO in and out) and `DraftShell` (a drafting form's page, with
the hub's slim phone header), all from `@civic-social/plugin-sdk/ui`. Keep your own CSS to layout; the suite's step
17 refuses dark text on the hub's primary colour. The straw poll's one page reads the poll and answers through the
hub's routes for every process (`GET /api/process/:id/state`, `POST /api/process/:id/action`):

```tsx
import { Button, type ProcessUi } from "@civic-social/plugin-sdk/ui";

const strawPollUi: ProcessUi = {
  type: "example.straw_poll",
  routes: [{ path: "/straw-poll/:id", element: <StrawPollPage /> }],
};
export default strawPollUi;
```

## 7. Run the suite

```bash
npx civic-conformance ./straw-poll
```

It checks the package's shape, what it imports (the SDK by name, its own files, Node's built-ins, its
`peerDependencies`), and that its migrations are additive. Then it starts a hub on your machine with your plugin in
it, makes two throwaway hubs (one where an admin reviews what residents submit, one that publishes at once), and walks
your type through every step its descriptor says applies:

1. the descriptor is well formed and agrees with the handler;
2. creation (a resident's draft and the Code of Conduct check, or an admin's create);
3. a failed approval leaves nothing public;
4. every action: allowed to whom it says, refused to everyone else; every result one the descriptor allows; no one's
   reference in what another person reads; **4b.** "once per participant" holds when calls arrive together;
5. the deadline: one close, however many readers notice it at once, and the scheduler's close with nobody reading;
6. archive and restore;
7. the plugin switched off (refused everywhere) and back on (all there);
8. every event it wrote is one it declared, published honestly, and nothing crosses to another hub;
9. (an outside service only) the hub's side of the service contract;
10. what counts as its participation is declared;
11. to 17., where your type uses them: an edit through the hub's edit path, a retry-safe action writing its events
    once, names shown under your disclosure policy, your own statuses, your own feed card, the official caller, and
    your pages on the hub's UI kit.

At the end it puts everything back: the throwaway hubs and all their rows, your plugin's tables (`--keep` keeps
them), its own list. A pass ends with `civic-conformance: … passed`. A failure names the step, what was expected and
what came back.

## 8. Submit it

Send Mosaic:

- **the package folder** (a git repository or an archive), with no `node_modules`;
- **the suite's passing output** from your machine;
- **a short note**: what the type is for, who would use it, and anything outside the hub it depends on.

What the review checks:

1. **The suite**, run again by Mosaic on the folder you sent, exactly as you ran it (`npm run catalog:add` does that
   and records the result).
2. **The code**, read by a person: that it does what the descriptor says and nothing else; that it reaches the hub
   only through the SDK; that it treats residents' data as the grant says.
3. **The grant, in the words a hub admin will read**: that they are true, and that nothing more is asked than the
   type needs.
4. **The migrations**: additive, under the hub's row-level security.

Approval is per version, and it is Mosaic's decision. An approved version is **signed** in Mosaic's catalog: the
signature covers the package's name, version, the fingerprint of its files and its grant. A hub runs a plugin only
when its files are exactly the signed ones; change one byte and it needs a new version and a new approval.

## After approval

- **Install** is each hub admin's choice, on their Plugins page, after reading your grant in plain words.
- **A new version** goes through the same suite and review. Hubs that have installed yours see "Update available"
  with what changes in what it can do, and update when their admin agrees. Until then, it keeps to what they approved
  (`host.allows`). Mosaic can mark a version required (a fix that cannot wait), which updates every hub, with a notice.
- **Removing** a plugin never deletes what it holds. *Stop now* takes it off the hub at once; *Wind down* lets what is
  open run to its close first.

## The license

The SDK carries the hub's engine, which is moving to the AGPL; until that is official, the `LICENSE` in each package is
what applies. Building and testing plugins with it is what it is for. Your plugin's own code is yours to license.

## Where things are

- The contract in full, for the hub's own packages: `docs/PLUGIN-PACKAGE.md` in the repository.
- The suite, step by step: `README.md` in `@civic-social/plugin-conformance`.
- The worked example: `examples/straw-poll/`.
