// The nouns the sample-removal warning counts a package's acts in (engine 2,
// B9): "2 people going to events". Each package declares its own on the table
// that records the act (manifest `tables[].sample.participation.nouns`); the
// hub's own kinds are in ui/src/pages/settings/sampleWarningText.ts.

import { MANIFEST_LIST } from "./processManifests.js";

export const DECLARED_KIND_NOUNS: Readonly<Record<string, readonly [string, string]>> = Object.fromEntries(
  MANIFEST_LIST.flatMap((m) =>
    m.tables.flatMap((t) => (t.sample && "child" in t.sample && t.sample.participation ? [[t.sample.participation.kind, t.sample.participation.nouns]] : [])),
  ),
);
