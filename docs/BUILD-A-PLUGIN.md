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
| `activities.listen` | The kernel events it listens for: `process.closed` only, today. `server(host)` returns `on.processClosed` for it. | |
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
- **Have its own colour:** manifest `colors` (a key, a label, the light pair, and optionally the dark pair and the email
  pill), and name its key in `color`. It is your plugin's default: a space type's palette may set the same key, and an
  admin's theme sets either. A space type that lists your key wins, so a hub looks the same whichever plugins it runs.
- **Have its own feed card kind and digest section:** manifest `feed.kinds` (its colour may sit on the kind).
- **Open an action to officials**, or let officials publish without review: the `official` caller,
  `creation.resident.publish_at_once: ["official"]`.
- **Say that an act is not taking part** (taking back "going"): `participation.withdrawal`.
- **Class its tables for sample content** and give its Plugins panel a help note: `tables[].sample`,
  `pluginSection.help`. Nothing outside your folder names your type.
- **Take a picture from residents** (an event's): `uploads: { images: true }` and `objectStore` in its grant; its
  page posts the file to `/api/upload/process-image/<type>` and keeps the URL it is given.
- **Write to the people taking part** (an announcement, or what changed): `notify(processId, accounts, { subject,
  text })` and `mail` in its grant. The hub holds the addresses and follows each person's email setting.
- **Know the hub it is serving**: `hubContext()` (its name, the origin its pages are at, its time zone). Never write
  a zone or a hub's address into your code.
- **Use a term another fediverse server publishes** (Mobilizon's `timezone`): declare it in `wireObject.contexts`.

`kit/conformance/fixtures/sdk-tour` in the hub's repository uses every one of these.

### Pinning (nothing to do)

Pinning is a plugin of its own (`features/pinning`, kernel step 4): whoever the space allows (admins by default, or
every member) pins any item to the Pinned card, with an optional end date, and may mark a pin urgent (listed first,
and the line across the top of the pages). Its Pin button sits at the bottom of every item page, beside Archive;
Admin → Pinned lists every pinned item. Your plugin writes no pin code and needs nothing in its manifest: its items can
be pinned as soon as they have a page (`detailPath`), and they show on the card with your type's label. A space can
switch Pinning off; your plugin works the same. There is no hook for a plugin to put its own rows on the card.

### Feedback (nothing to do)

Feedback is a plugin of its own too (`features/feedback`, kernel step 4): the form residents use to report a problem or
suggest something, and Admin → Feedback. A space can switch it off. Your plugin needs nothing for it. If your plugin is a
feature with an inbox of its own, name its queue (`FeatureServer.queues`): the kernel then counts what is new for each
admin on your admin tab (`adminTab.queue` in your UI module) and adds a line to the admin digest. A page for everyone
(a form, say) can ask for the same links Feedback has, in the top bar, sidebar, menu and footer (`spaceLink`).

### Members (nothing to do)

The member count, the faces on the home page and the Members page are a plugin of their own (`features/members`, kernel
step 4). Who has joined a space is the kernel's: a plugin that needs it reads `membership` (`count()`, `summary()`,
`list(offset)`; never an address). A feature with a page of its own in the navigation declares it in its manifest
(`section`), and its UI module can say who sees it yet and the number beside it (`section.shown`, `section.count`).

### Member information (districts and demographics)

A hub can ask its members which district they live in, their year of birth and, if the hub chooses, their race or
ethnicity. Each answer is optional and each member is asked once. The answers belong to the member: only they see
them, in Settings > About you, and they go when the account is deleted.

**Plugins never get members' answers, and never get the breakdowns made from them.** There is no SDK call for either.

**Your plugin needs to do nothing.** When a process finishes, the hub itself adds results by district and by age
group (and by race, where the hub asks) to its page, and to its brief if it has one. It counts the people who took
part from the `participation` events your manifest declares, plus the hub's own comments, so declare those
accurately. Every group under 5 people is hidden. Your plugin works the same whether a hub asks these questions or
not.

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
with the hub's UI kit so they look like the hub's own pages, in whatever colours, font, light or dark the hub and
its readers have chosen: `Button`, `Field`, `TextInput`, `TextArea`, `Select`, `Checkbox`, `RadioCards`,
`ChipGroup`, `DateTimeInput` (ISO in and out, with the hub's picker; `timeZone` to enter a time in a zone other
than the reader's), `ImageUpload`, `Card`, `Stat` and `StatGrid`, `Table`, `PageHead` and `DraftShell` (a drafting
form's page, with the hub's slim phone header), all from `@civic-social/plugin-sdk/ui`.

**A plugin never sets a colour, a font or a size of its own.** Where you need layout of your own, use the hub's
tokens (`var(--space-4)`, `var(--color-text-muted)`, …). [How a plugin looks](PLUGIN-STYLE.md) lists the tokens and
which kit component to use when; the suite's step 21 checks your stylesheets and inline styles, and step 17 refuses
dark text on the hub's primary colour. The straw poll's one page reads the poll and answers through the
hub's routes for every process (`GET /api/process/:id/state`, `POST /api/process/:id/action`):

```tsx
import { Button, type ProcessUi } from "@civic-social/plugin-sdk/ui";

const strawPollUi: ProcessUi = {
  type: "example.straw_poll",
  routes: [{ path: "/straw-poll/:id", element: <StrawPollPage /> }],
};
export default strawPollUi;
```

A type can also add to the hub's own pages with `contributes`, drawn only while its plugin is on:

- `processTop`: a component (given `processId`) drawn at the top of every process page, under its header. Briefs
  draws its "Read the brief" pointer there.
- `adminQueue`: a tab in the admin rail's Review group (`{ queue, label, icon, path }`), with the count of what arrived
  since the admin last opened it. `queue` is the name your manifest gives `publication.queue`; your admin page calls
  `markAdminQueueSeen(queue)` when it opens.
- `welcomeStrip`: a component drawn in the strip across the top of the hub's public pages (Word clouds' teaser).
- `afterSignUp`: where a new member goes right after signing up (Word clouds: the hub's word cloud), given the page
  they signed up on as a checked local path to come back to, or null.

A page reads its own settings with `useSpace().setting("plugin.<your id>.…")`.

### Sample content: `samples`

A new hub can start with sample content so it does not look empty, and a plugin can make its own. Return
`samples` from `server(host)`:

```ts
import type { SampleKit, SampleTemplate } from "@civic-social/plugin-sdk";

async function seed(template: SampleTemplate, kit: SampleKit) {
  const p = await kit.create({                       // marked as sample; dated `template.at` days from now
    title: kit.fill("Lunch for {HUB_NAME}?"),        // the hub's names filled in
    description: "",
    state: { question: kit.fill(String(template.question)) },
  });
  // ...your own records through host.db(), your events with kit.emitAt(kit.at(-2))
}

return {
  handler,
  samples: {
    seed,
    defaults: () => [{ key: "straw_poll_lunch", by: "TEAM", at: -3, question: "Pizza or tacos?" }],
  },
};
```

- `seed(template, kit)` makes one sample of your type. The hub's space type may bring its own templates for your type
  (the Civic Hub brings a word cloud, for instance); `defaults()` are yours, used only where the space type brings
  none of your type. A key is unique on the hub; the sample's process id is made from it.
- The kit gives you the hub's sample people (`kit.author("JORDAN")`; `by` on a template), times relative to now
  (`kit.at(days, minutes)`, `at` on a template), `kit.fill(text)` for `{HUB_NAME}`, `{JURISDICTION}` and
  `{GOVERNING_BODY}`, `create`, `save`, `comment`, `process(key)` (the sample this one is made from), `ballots(processId,
  choices)` for anonymous sample ballots (the kernel keeps every ballot), and `adoptSetting(key, value)` to set one of your
  own settings when the hub has none (Word clouds makes its sample the hub's word cloud this way).
- Optional: `title(template)` names a sample in the admin's lists when its name is not `title` (Briefs: the headline);
  `refresh` keeps a demo hub current (`live(template)` for a sample there to show something live, `reason(template, row,
  window)` for why it must be replaced now, `window.near(deadline)` for "within a few days"); `repair(template, state,
  fill)` gives an older sample a field added since.
- Everything a sample creates is marked as sample: its events never reach the public log or a digest, and the admin's
  Remove sample content takes all of it. Send nothing outside the hub from a seed.
- Every first-party type seeds its own: `packages/<pkg>/samples.ts` (Word clouds is the shortest; Votes shows ballots
  and `refresh`). The words are the space type's (the Civic Hub's: `spaces/civic/sampleTemplates.ts`).

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

The SDK carries the hub's engine, which is licensed under the GNU AGPL 3.0 or later (the `LICENSE` in each
package). Building and testing plugins with it is what it is for. Your plugin's own code is yours to license.

## Where things are

- The contract in full, for the hub's own packages: `docs/PLUGIN-PACKAGE.md` in the repository.
- The suite, step by step: `README.md` in `@civic-social/plugin-conformance`.
- The worked example: `examples/straw-poll/`.
- How a plugin looks (the tokens, the kit, the never-set-your-own rule): `docs/PLUGIN-STYLE.md`.
