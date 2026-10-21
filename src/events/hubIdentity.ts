// What a hub says about who it is and where it went (ADR-008).
//
// THE DID DOCUMENT. A hub's `space_did` is `generator.id` on everything it
// publishes, a `did:web:` named after the hostname it was created on, and it
// does not change when the hub moves. did:web resolves `did:web:<host>` by
// fetching https://<host>/.well-known/did.json, so:
//   - on the hostname its DID names, the hub serves its document;
//   - on an address it moved away from, that address still serves the
//     document (not a redirect), with its services pointing at where the hub
//     is now. The identity survives the move for as long as the old domain
//     still reaches this deployment;
//   - on any other hostname, no DID document: that hostname names no DID of
//     this hub.
// The document has no keys: the hub signs nothing yet, so it asserts only
// that this DID is this hub and where its services are. did:webvh, a history
// that survives losing the old domain, comes with signing (ADR-008).
//
// THE MOVE SIGNAL. An address a hub moved away from answers
// /.well-known/civic.json with a `moved` tombstone instead of a redirect, and
// every redirect from it carries a Link to that tombstone. The tombstone names
// the hub's Move activity when there is one (a console move writes it; a
// hand-set redirect_to does not).

import type { Hub } from "../models/hub.js";

export const DID_CONTEXT = "https://www.w3.org/ns/did/v1";
export const DID_JSON = "application/did+json";

/** The Link relation a redirect from a hub's old address carries to its tombstone. */
export const MOVED_REL = "https://www.civic.social/ns/civic-hub#moved";

/** The did:web DID a hostname names (no port: hub hostnames carry none). */
export function didWebFor(hostname: string): string {
  return `did:web:${hostname.trim().toLowerCase()}`;
}

/** True when this hub's DID is the one `hostname` names. */
export function hubDidIsServedOn(hub: Pick<Hub, "space_did">, hostname: string): boolean {
  return (hub.space_did ?? "").trim().toLowerCase() === didWebFor(hostname);
}

/**
 * The hub's DID document. `liveOrigin` is where the hub answers now: its own
 * origin, or for a moved hub the new one.
 */
export function didDocument(hub: Pick<Hub, "space_did">, liveOrigin: string): Record<string, unknown> {
  const did = hub.space_did.trim();
  return {
    "@context": [DID_CONTEXT],
    id: did,
    alsoKnownAs: [liveOrigin],
    service: [
      { id: `${did}#civic-hub`, type: "CivicHub", serviceEndpoint: `${liveOrigin}/.well-known/civic.json` },
      { id: `${did}#activities`, type: "CivicActivityStream", serviceEndpoint: `${liveOrigin}/events` },
    ],
  };
}

/** What the old address's civic.json says: the hub moved, and where to. */
export function movedManifest(
  hub: Pick<Hub, "space_did" | "name">,
  liveOrigin: string,
  move: { activity: string; published: string } | null,
): Record<string, unknown> {
  return {
    name: hub.name,
    moved: {
      to: `${liveOrigin}/.well-known/civic.json`,
      origin: liveOrigin,
      space: hub.space_did,
      activity: move?.activity ?? null,
      published: move?.published ?? null,
    },
  };
}

/** The Link header a redirect from an old address carries. */
export function movedLinkHeader(oldOrigin: string): string {
  return `<${oldOrigin}/.well-known/civic.json>; rel="${MOVED_REL}"`;
}
