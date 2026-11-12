// The operator API over HTTP (the console split): the hub's router
// (src/operator/router.ts), called as the console calls it, with a stand-in
// implementation. A refusal crosses with its status, code and words; the
// credential is required; the whole thing is absent without
// CIVIC_OPERATOR_TOKEN.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { operatorRouter } from "../../src/operator/router.js";
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

/** One call as the console makes it: POST /operator/rpc/<method> { args }, the token as a bearer. */
async function rpc(token: string, method: string, ...args: unknown[]): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/operator/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ args }),
  });
  return { status: res.status, body: await res.json() };
}

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
    expect(await rpc(TOKEN, "getHub", "floyd")).toEqual({ status: 200, body: { result: { id: "floyd", name: "Floyd" } } });
    expect(await rpc(TOKEN, "getHub", "nowhere")).toEqual({ status: 200, body: { result: null } });
    expect((await rpc(TOKEN, "setAdmins", "floyd", ["a@example.test"], "op@example.test")).status).toBe(200);
    expect(calls).toEqual([
      { method: "getHub", args: ["floyd"] },
      { method: "getHub", args: ["nowhere"] },
      { method: "setAdmins", args: ["floyd", ["a@example.test"], "op@example.test"] },
    ]);
  });

  it("answers a refusal with its status, code and words", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    expect(await rpc(TOKEN, "archive", "floyd")).toEqual({
      status: 400,
      body: { error: "This hub is already archived.", code: "invalid_request" },
    });
  });

  it("keeps an unexpected failure's details on the hub", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    const res = await rpc(TOKEN, "listHubs");
    expect(res.status).toBe(500);
    expect(res.body.ref).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain("secrets");
  });

  it("refuses a caller without the token", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    expect((await rpc("wrong-token", "getHub", "floyd")).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("does not exist without CIVIC_OPERATOR_TOKEN", async () => {
    delete process.env.CIVIC_OPERATOR_TOKEN;
    expect((await rpc("", "getHub", "floyd")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("answers 404 for a method the interface does not have", async () => {
    process.env.CIVIC_OPERATOR_TOKEN = TOKEN;
    expect((await rpc(TOKEN, "dropEverything")).status).toBe(404);
  });
});
