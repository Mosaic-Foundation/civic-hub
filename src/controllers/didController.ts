// GET /.well-known/did.json — the hub's DID document (ADR-008).
//
// Served only on the hostname the hub's DID names (did:web resolution). An
// address the hub moved away from serves it from the resolver instead
// (src/middleware/hub.ts), pointing at where the hub is now.

import { route } from "../http/route.js";
import { NotFoundError } from "../errors/index.js";
import { currentHub } from "../config/hubContext.js";
import { baseUrl } from "../utils/baseUrl.js";
import { DID_JSON, didDocument, hubDidIsServedOn } from "../events/hubIdentity.js";

export const handleDidDocument = route((_req, res) => {
  const hub = currentHub();
  if (!hub || !hubDidIsServedOn(hub, hub.hostname)) {
    throw new NotFoundError("No DID document is served at this address.");
  }
  res.setHeader("Content-Type", `${DID_JSON}; charset=utf-8`);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(JSON.stringify(didDocument(hub, baseUrl())));
});
