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
import { liveProposal } from "../fixtures/liveProcess.js";

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
});
