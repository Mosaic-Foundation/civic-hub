// The hub's extension namespace document.
//
// Every activity that uses a hub-local term declares `"hub":
// "{baseUrl}/ns#"` in its `@context` (activitySerializer.hubNamespace). That
// IRI has to resolve to something a consumer can read: before this, it fell
// through Vercel's rewrites to the SPA and a consumer dereferencing `hub:`
// got a page of React (Adam, 2026-09-04, spec audit).
//
// It also serves as this space's declaration of the extension terms it emits.
// Civic Activity Spec v0.2 §3.4: extension terms are defined under a domain
// their author controls, MUST NOT redefine AS2 or civic semantics, and the
// types a space emits are declared rather than left for consumers to infer.
// EXTENSION_TERMS in the serializer is the single source — the register here
// cannot drift from what the mapping table can actually emit, and
// tests/unit/extensionTerms.test.ts fails if a term is emitted undeclared.

import type { Request, Response } from "express";
import {
  EXTENSION_TERMS,
  hubNamespace,
  CIVIC_CONTEXT,
} from "../events/activitySerializer.js";
import { hubName } from "../config/hub.js";

const LD_JSON = "application/ld+json; charset=utf-8";

export function handleGetNamespace(_req: Request, res: Response): void {
  const ns = hubNamespace();

  res.setHeader("Content-Type", LD_JSON);
  // A namespace document is stable between deploys; let consumers cache it.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    "@context": {
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      hub: ns,
      civic: CIVIC_CONTEXT,
      label: "rdfs:label",
      comment: "rdfs:comment",
      terms: { "@id": "rdfs:member", "@container": "@set" },
    },
    "@id": ns,
    label: `${hubName()} extension terms`,
    comment:
      "Hub-local terms this space emits in Civic Activity documents. Each is a " +
      "promotion candidate for the canonical civic context: they exist because " +
      "no canonical class covers them yet, and none redefines an ActivityStreams " +
      "or civic term.",
    terms: EXTENSION_TERMS.map((t) => ({
      "@id": `hub:${t.term.replace(/^hub:/, "")}`,
      label: t.term,
      kind: t.kind,
      comment: t.why,
    })),
  });
}
