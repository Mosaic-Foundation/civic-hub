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
//
// Since 2026-10-20 (ADR-008) this is the per-hub namespace of activities
// stored before then; newer ones declare the software-level namespace,
// https://www.civic.social/ns/civic-hub# (src/events/namespaceDocument.ts).

import { route } from "../http/route.js";
import { hubNamespace } from "../events/activitySerializer.js";
import { namespaceDocument } from "../events/namespaceDocument.js";
import { hubName } from "../config/hub.js";

const LD_JSON = "application/ld+json; charset=utf-8";

export const handleGetNamespace = route((_req, res) => {
  res.setHeader("Content-Type", LD_JSON);
  // A namespace document is stable between deploys; let consumers cache it.
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(namespaceDocument(hubNamespace(), `${hubName()} extension terms`));
});
