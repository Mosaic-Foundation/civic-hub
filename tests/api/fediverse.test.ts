// The Fediverse feature against the running server (features/fediverse/):
// off by default, so a new hub answers nothing on the fediverse paths; once
// its admin switches it on, the hub's handle finds its account, the account
// has a profile, NodeInfo says what software this is, an unsigned delivery is
// refused, and the admin sees the handle and follower count. The follow round
// trip itself, signed both ways, is tests/unit/fediverse.test.ts.
//
// Needs the local stack seeded as in CI and a server (CIVIC_API_BASE).

import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { call } from "../fixtures/hostCall.js";
import { mintSession } from "../fixtures/adminSession.js";
import { createHub } from "../fixtures/operator.js";

const tag = randomBytes(3).toString("hex");
const SLUG = `fd-${tag}`;
const HOST = `${SLUG}.localhost`;
const ADMIN = `fediverse-admin-${tag}@example.test`;
const AP = { Accept: "application/activity+json" };

let admin = "";
let origin = "";

async function switchTo(on: boolean): Promise<void> {
  const res = await call("PUT", "/admin/hub/settings", HOST, { section: "plugins", values: { "plugin.fediverse.enabled": on ? "true" : "false" } }, admin);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  const made = await createHub({ slug: SLUG, name: `Fediverse Test ${tag}`, hostname: HOST, admin_email: ADMIN, hub_kind: "other" });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  admin = await mintSession(SLUG, ADMIN);
});

describe("the hub's fediverse account", () => {
  it("is off until the hub switches it on", async () => {
    const config = await call("GET", "/hub-config", HOST);
    expect(config.body.settings["plugin.fediverse.enabled"]).toBe("false");
    const wf = await call("GET", `/.well-known/webfinger?resource=acct:${HOST}@${HOST}`, HOST);
    expect(wf.status).toBe(404);
    expect((await call("GET", "/ap/hub", HOST, undefined, undefined, undefined, AP)).status).toBe(404);
    expect((await call("GET", "/admin/fediverse", HOST, undefined, admin)).status).toBe(404);
  });

  it("answers once switched on: handle, profile and NodeInfo", async () => {
    await switchTo(true);
    const wf = await call("GET", `/.well-known/webfinger?resource=acct:${HOST}@${HOST}`, HOST);
    expect(wf.status).toBe(200);
    const self = (wf.body.links as Array<{ rel: string; href: string }>).find((l) => l.rel === "self")!.href;
    expect(self.endsWith("/ap/hub")).toBe(true);
    origin = self.replace(/\/ap\/hub$/, "");
    expect(new URL(origin).hostname).toBe(HOST);

    // The short form finds the same account.
    const short = await call("GET", `/.well-known/webfinger?resource=acct:${SLUG}@${HOST}`, HOST);
    expect(short.status).toBe(200);

    const actor = await call("GET", "/ap/hub", HOST, undefined, undefined, undefined, AP);
    expect(actor.status).toBe(200);
    expect(actor.body.type).toBe("Service");
    expect(actor.body.id).toBe(self);
    expect(actor.body.preferredUsername).toBe(HOST);
    expect(actor.body.name).toBe(`Fediverse Test ${tag}`);
    expect(actor.body.inbox).toBe(`${origin}/ap/hub/inbox`);
    expect(actor.body.publicKey.publicKeyPem).toContain("BEGIN PUBLIC KEY");

    // The same key on the next read: made once, kept.
    const again = await call("GET", "/ap/hub", HOST, undefined, undefined, undefined, AP);
    expect(again.body.publicKey.publicKeyPem).toBe(actor.body.publicKey.publicKeyPem);

    const ni = await call("GET", "/nodeinfo/2.1", HOST);
    expect(ni.status).toBe(200);
    expect(ni.body.software.name).toBe("civic-hub");
    expect(ni.body.protocols).toEqual(["activitypub"]);
  });

  it("sends a browser at the account's address to the hub", async () => {
    const res = await call("GET", "/ap/hub", HOST, undefined, undefined, undefined, { Accept: "text/html" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("refuses an unsigned delivery to its inbox", async () => {
    const res = await call(
      "POST",
      "/ap/hub/inbox",
      HOST,
      { "@context": "https://www.w3.org/ns/activitystreams", id: "https://social.example/f/1", type: "Follow", actor: "https://social.example/users/x", object: `${origin}/ap/hub` },
      undefined,
      undefined,
      { "Content-Type": "application/activity+json" },
    );
    expect(res.status).toBe(401);
  });

  it("shows the admin the handle and follower count", async () => {
    const res = await call("GET", "/admin/fediverse", HOST, undefined, admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ handle: `@${HOST}@${HOST}`, actor_url: `${origin}/ap/hub`, followers: 0, ready: true });
    expect((await call("GET", "/admin/fediverse", HOST)).status).toBe(401);
  });

  it("goes quiet again when switched off", async () => {
    await switchTo(false);
    expect((await call("GET", "/ap/hub", HOST, undefined, undefined, undefined, AP)).status).toBe(404);
    expect((await call("GET", "/nodeinfo/2.1", HOST)).status).toBe(404);
  });
});
