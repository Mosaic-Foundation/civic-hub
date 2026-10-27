# Participation, declared; the event log as counts (for plugin developers)

A developer note for the docs site's Developers section to mirror (ADR-016). It adds to `docs/BUILD-A-PLUGIN.md` and
`docs/PLUGIN-PACKAGE.md`.

## Declaring what counts as participation

A hub counts participation for every process type the same way, from what the type declares. Your manifest's
`participation` says which of your events record a resident taking part, and which create, close and record the outcome
of one of your processes:

```ts
participation: {
  participation: ["civic.process.submission_received"],   // one event per act, named by its actor
  creation: ["civic.process.created"],
  closing: ["civic.process.ended"],
  outcome: ["civic.process.result_published"],
},
```

- If residents never take part in your type (the hub makes it, as it makes a brief), say `participation: "none"`.
- If they take part outside the hub and another type records how many did (a conversation in Polis, whose brief
  records the total), say `participation: "elsewhere"`. The summarizing type declares `sourceField` (the payload field
  naming the process it summarizes) and `sourceTotals` (`[{ event, field }]`).
- `measures` says which of the funder measures (`met_in_public`, `worked_with_neighbours`, `contacted_an_official`;
  `src/shared/participation.ts`) your participation or your outcome feeds. Most types feed none.
- Comments and submissions for review are the hub's own events and are counted for every type; do not list them.
- Name only events your type emits (its descriptor's `emits`) or the hub's lifecycle events.

The conformance suite's **step 10** requires the declaration: at least one participation event, or `"elsewhere"` or
`"none"` said outright; and every resident's or creator's action that emits anything must emit at least one event the
declaration counts. `participationProblem()` (in `@civic-social/plugin-sdk/testing`) is the check it runs.

What the hub does with it: Admin → Activity, `/analytics` and the console count your type from the day it is installed.
Counts only; nothing per person leaves the database.

## Feature packages, and the event log as counts

A hub feature that is not a process type can be built the way a package is (`src/plugins/feature.ts`): one folder under
`features/`, a plain-data `manifest.ts` (its tables and jobs), an `index.ts` exporting a `FeaturePackage` whose
`server(host)` returns its routes, admin routes, job runners, console section and admin digest line, and a `ui.tsx`. It
reaches the hub through the SDK and `src/shared/` only. Activity (`features/analytics/`) is the first.

A feature's host gives it its own tables (`host.db()`) and the one read capability features have: `host.eventLog()`,
an `EventLogReader`.

- `types()`: every installed process type's name and declared participation.
- `countByDay(tz, from, to)`: the hub's events per local day, process type and event type.
- `countActors(tz, range, plan)`: counts of distinct residents over the events a plan names (`ActorCountPlan`).

No method returns an event, an actor or a payload. Feature packages are first-party today; ADR-016 lists what the
loader and catalog need before one can be installed from the catalog.
