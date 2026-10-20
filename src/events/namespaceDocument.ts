// The extension namespace document: the register of `hub:` terms, as JSON-LD.
//
// Two places serve it (ADR-008):
//   - https://www.civic.social/ns/civic-hub — the one software-level
//     namespace activities stored from 2026-10-20 declare. The website serves
//     config/ns/civic-hub.jsonld, a copy of softwareNamespaceDocument();
//     tests/unit/namespaceDocument.test.ts fails when the copy drifts.
//   - GET /ns on every hub — the per-hub `{origin}/ns#` that activities
//     stored before then declare, so their terms keep resolving.
// EXTENSION_TERMS in the serializer is the single source for both.

import { CIVIC_CONTEXT, EXTENSION_TERMS, HUB_EXTENSION_NS } from "./activitySerializer.js";

export function namespaceDocument(ns: string, label: string): Record<string, unknown> {
  return {
    "@context": {
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      hub: ns,
      civic: CIVIC_CONTEXT,
      label: "rdfs:label",
      comment: "rdfs:comment",
      terms: { "@id": "rdfs:member", "@container": "@set" },
    },
    "@id": ns,
    label,
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
  };
}

/** The software-level namespace's document, as the website publishes it. */
export function softwareNamespaceDocument(): Record<string, unknown> {
  return namespaceDocument(HUB_EXTENSION_NS, "Civic Hub extension terms");
}
