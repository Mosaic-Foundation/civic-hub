// The operator API over HTTP (the console split): the console's client
// (src/control/operatorClient.ts) against the hub's router
// (src/operator/router.ts), with a stand-in implementation. A refusal
// crosses with its status, code and words; the credential is required; the
// whole thing is absent without CIVIC_OPERATOR_TOKEN.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { operatorRouter } from "../../src/operator/router.js";
import { httpOperator } from "../../src/control/operatorClient.js";
import { ALL_METHODS_LISTED, OPERATOR_METHODS, type OperatorApi } from "../../src/operator/api.js";
import { CivicError } from "../../src/errors/index.js";

const TOKEN = "test-operator-token-0123456789";
const saved = process.env.CIVIC_OPERATOR_TOKEN;

const calls: Array<{ method: string; args: unknown[] }> = [];
const fake = {
  async getHub(id: string) {
    calls.push({ method: "getHub", args: [id] });
    return id === "floyd" ? { id: "floyd", name: "Floyd" } : null;
  },
  async archive(id: string) {
    calls.push({ method: "archive", args: [id] });
    throw new CivicError(400, "invalid_request", "This hub is already archived.");
  },
  async listHubs() {
    throw new Error("database exploded with secrets");
  },
  async setAdmins(id: string, admins: string[], actor: string) {
    calls.push({ method: "setAdmins", args: [id, admins, actor] });
  },
} as unknown as OperatorApi;

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(operatorRouter(() => fake));
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

afterEach(() => {
  calls.length = 0;
  if (saved === undefined) delete process.env.CIVIC_OPERATOR_TOKEN;
  else process.env.CIVIC_OPERATOR_TOKEN = saved;
});

describe("the operator API over HTTP", () => {
  it("lists every method of the interface", () => {
    expect(ALL_METHODS_LISTED).toBe(true);
    expect(new Set(OPERATOR_METHODS).size).toBe(OPERATOR_METHODS.length);
  });

  it("calls the hub's implementation with the arguments and returns its result", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    const op = httpOperator(base, TOKEN);
    expect(await op.getHub("floyd")).toEqual({ id: "floyd", name: "Floyd" });
    expect(await op.getHub("nowhere")).toBeNull();
    await op.setAdmins("floyd", ["a@example.test"], "op@example.test");
    expect(calls).toEqual([
      { method: "getHub", args: ["floyd"] },
      { method: "getHub", args: ["nowhere"] },
      { method: "setAdmins", args: ["floyd", ["a@example.test"], "op@example.test"] },
    ]);
  });

  it("brings a refusal back as the same CivicError", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    const err = await httpOperator(base, TOKEN).archive("floyd").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CivicError);
    expect(err).toMatchObject({ status: 400, code: "invalid_request", message: "This hub is already archived." });
  });

  it("keeps an unexpected failure's details on the hub", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    const err = (await httpOperator(base, TOKEN).listHubs().catch((e: unknown) => e)) as CivicError;
    expect(err.status).toBe(500);
    expect(err.message).not.toContain("secrets");
  });

  it("refuses a caller without the token", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    const err = (await httpOperator(base, "wrong-token").getHub("floyd").catch((e: unknown) => e)) as CivicError;
    expect(err.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("does not exist without CIVIC_OPERATOR_TOKEN", async () => {
    delete process.env.CIVIC_OPERATOR_TOKEN;
    const err = (await httpOperator(base, "").getHub("floyd").catch((e: unknown) => e)) as CivicError;
    expect(err.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("answers 404 for a method the interface does not have", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    const res = await fetch(`${base}/operator/rpc/dropEverything`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ args: [] }),
    });
    expect(res.status).toBe(404);
  });
});
