// A live proposal or project for a test that needs one, made the way the hub
// now makes them: a resident's draft, held for an admin (the Code of Conduct
// check unavailable), approved by the hub's admin. POST /proposals and
// POST /projects are gone; they skipped review.

import { admin, approve, BETA, DEMO, submitDraft, type Hub } from "../../kit/conformance/src/driver.js";
import { hostFacts } from "../../kit/conformance/src/hostFacts.js";
import { getDescriptor } from "../../src/processes/registry.js";

function hubFor(host: string): Hub {
  if (host === BETA.host) return BETA;
  if (host === DEMO.host) return DEMO;
  throw new Error(`liveProcess: no hub known for host ${host}`);
}

async function live(type: string, host: string, token: string, title: string, description?: string): Promise<string> {
  const hub = hubFor(host);
  const d = getDescriptor(type);
  if (!d) throw new Error(`liveProcess: no descriptor for ${type}`);
  const s = await submitDraft(d, hostFacts(), hub, token, {
    check: "unavailable",
    title,
    fields: description === undefined ? undefined : { description },
  });
  if (s.status !== 201) throw new Error(`${type}: submit answered ${s.status} ${JSON.stringify(s.body)}`);
  const ok = await approve(hub, await admin(hub), s.reviewId);
  if (ok.status !== 200) throw new Error(`${type}: approval answered ${ok.status} ${JSON.stringify(ok.body)}`);
  return s.processId;
}

export function liveProposal(host: string, residentToken: string, title: string, description?: string): Promise<string> {
  return live("civic.proposal", host, residentToken, title, description);
}

export function liveProject(host: string, residentToken: string, title: string, description?: string): Promise<string> {
  return live("civic.project", host, residentToken, title, description);
}
