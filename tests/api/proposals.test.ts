/**
 * Proposal endpoint tests.
 *
 * Tests the public proposal submission and listing flow.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  api,
  apiJson,
  getResidentToken,
  getBasicToken,
  authHeaders,
} from "../fixtures/helpers.js";
import { DEMO } from "../../kit/conformance/src/driver.js";
import { liveProject, liveProposal } from "../fixtures/liveProcess.js";

describe("Proposal endpoints", () => {
  let residentToken: string;
  let basicToken: string;

  beforeAll(async () => {
    residentToken = await getResidentToken();
    basicToken = await getBasicToken();
  });

  it("GET /proposals returns a list", async () => {
    const { status, body } = await apiJson<unknown[]>("/proposals");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /proposals is gone: a JSON 404 in the error shape, signed in or not", async () => {
    const body = JSON.stringify({ title: "Test proposal", description: "Removed route" });
    for (const headers of [{}, authHeaders(residentToken), authHeaders(basicToken)]) {
      const res = await api("/proposals", { method: "POST", headers, body });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: expect.any(String), code: "not_found" });
    }
  });

  it("GET /proposals/:id returns proposal detail", async () => {
    const id = await liveProposal(DEMO.host, residentToken, `Detail test ${Date.now()}`, "For detail endpoint test");

    const { status, body } = await apiJson<{ id: string; title: string }>(
      `/proposals/${id}`,
    );
    expect(status).toBe(200);
    expect(body.id).toBe(id);
  });

  // The kernel's processesOf("civic.proposal") (kernel step 1): the package
  // reads and acts on its own type only, so another type's id is not found
  // through its routes, while its own works.
  it("another type's id is not found through the proposal routes", async () => {
    const project = await liveProject(DEMO.host, residentToken, `Not a proposal ${Date.now()}`, "A project");
    expect((await api(`/proposals/${project}`)).status).toBe(404);
    for (const method of ["POST", "DELETE"]) {
      const res = await api(`/proposals/${project}/support`, { method, headers: authHeaders(residentToken) });
      expect(res.status, `${method} support on a project`).toBe(404);
    }
    const own = await liveProposal(DEMO.host, residentToken, `Supported ${Date.now()}`, "Its own type");
    const res = await apiJson<{ support_count: number; view: { id: string } | null }>(`/proposals/${own}/support`, {
      method: "POST",
      headers: authHeaders(residentToken),
    });
    expect(res.status).toBe(200);
    expect(res.body.view?.id).toBe(own);
  });
});
