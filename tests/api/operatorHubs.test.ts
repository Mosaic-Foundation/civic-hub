// Making and running hubs through the operator API (src/operator/), the hub's
// side of the console's Create hub, Edit hub, admins, archive and handover
// (Phase 5 part one, 2026-09-26; the console split, 2026-11-11). The console's
// own sign-in, fresh codes and audit log are the console's
// (Mosaic-Foundation/mosaic-console).
//
// On the local stack. Every hub this file creates is archived in afterAll, so
// the per-hub job runs in crons.test.ts see only Floyd and Athens: an archived
// hub is suspended, and jobs walk active hubs. An archived hub's slug stays
// taken.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { call } from "../fixtures/hostCall.js";
import { API_BASE } from "../fixtures/helpers.js";
import { localRest } from "../fixtures/adminSession.js";
import {
  OPERATOR,
  archiveHub,
  createHub,
  hubDetail,
  operator,
  refreshSamples,
  setAdmins,
  unarchiveHub,
  updateHandover,
  updateHub,
} from "../fixtures/operator.js";

const run = Date.now().toString(36);
const SLUG = `ctl-${run}`;
const HOST = `ctl-${run}.localhost`;
const created: string[] = [];

/** A browser-style GET on `host`, not following redirects: status and Location. */
function rawGet(path: string, host: string): Promise<{ status: number; location: string | undefined }> {
  const url = new URL(`${API_BASE}${path}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET", headers: { Host: host, Accept: "text/html" } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}


afterAll(async () => {
  for (const id of created) {
    const res = await archiveHub(id);
    if (res.status !== 200 && !/already archived/.test(res.body.error ?? "")) {
      throw new Error(`could not archive ${id}: ${JSON.stringify(res.body)}`);
    }
  }
});

describe("create hub", () => {
  it("refuses a reserved slug, naming what it is for", async () => {
    const res = await createHub({ slug: "console", name: "X", hostname: `x-${run}.localhost`, admin_email: "a@example.test", hub_kind: "other" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reserved");
  });

  it("refuses a hub without a first admin", async () => {
    const res = await createHub({ slug: `noadmin-${run}`, name: "X", hostname: `noadmin-${run}.localhost`, hub_kind: "other" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("admin");
  });

  it("creates a demo hub by default, which serves at its hostname", async () => {
    const res = await createHub({
        slug: SLUG,
        name: "Console Test Hub",
        hostname: HOST,
        jurisdiction_name: "Testing, Nowhere",
        jurisdiction_custom: true,
        governing_body: "Testing Council",
        admin_email: `first-admin-${run}@example.test`,
        // Who runs it (review R48, session 4).
        ownership: {
          "legal.operator_name": "the Testing Moderators",
          "legal.contact_email": `hello-${run}@example.test`,
          "email.postal_address": "PO Box 1, Testing",
          "plugin.feedback.contact_email": `feedback-${run}@example.test`,
        },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(SLUG);
    expect(res.body.hub).toMatchObject({ id: SLUG, hostname: HOST, mode: "demo", status: "active", archived_at: null });
    expect(res.body.admins).toEqual([`first-admin-${run}@example.test`]);
    expect(res.body.handover.values["copy.governing_body_name"]).toBe("Testing Council");
    expect(res.body.handover).toMatchObject({
      editable: true,
      values: {
        "identity.name": "Console Test Hub",
        "legal.operator_name": "the Testing Moderators",
        "legal.contact_email": `hello-${run}@example.test`,
        "email.from_name": "Console Test Hub",
        "email.postal_address": "PO Box 1, Testing",
        "plugin.feedback.contact_email": `feedback-${run}@example.test`,
      },
    });
    // The first admin is told (review R38); locally, with no mail key, the invite is logged.
    expect(res.body.invites).toEqual({ sent: [`first-admin-${run}@example.test`], not_sent: [] });
    expect(res.body.message).toContain("Sent the admin invite");

    const config = await call("GET", "/hub-config", HOST);
    expect(config.status).toBe(200);
    expect(config.body.hub).toMatchObject({ id: SLUG, mode: "demo" });
    // Every new hub starts with the platform's banner, as its own setting
    // (2026-10-08), which the admin can replace or clear.
    expect(config.body.settings["identity.banner_url"]).toBe("/hub-banner-default.webp");
    expect(config.body.settings["identity.banner_alt"]).toBeTruthy();
    // The Feedback page's address is public; the postal address is not.
    expect(config.body.settings["plugin.feedback.contact_email"]).toBe(`feedback-${run}@example.test`);
    expect(config.body.settings["legal.operator_name"]).toBe("the Testing Moderators");
    expect(config.body.settings["email.postal_address"]).toBeUndefined();

    // A new hub's resident-created votes need no endorsements (2026-10-13).
    const stored = (await localRest(`hub_settings?select=key,value&hub_id=eq.${SLUG}`)) as Array<{ key: string; value: string }>;
    const setting = (key: string) => stored.find((r) => r.key === key)?.value;
    expect(setting("plugin.vote.support_threshold")).toBe("0");
    expect(setting("people.admin_emails")).toContain(`first-admin-${run}@example.test`);
    // The hub records who made it, as the console names its operator.
    expect((await localRest(`hub_settings?select=updated_by&hub_id=eq.${SLUG}&key=eq.identity.name`)) as unknown[]).toEqual([
      { updated_by: `console:${OPERATOR}` },
    ]);
  });

  it("refuses a slug or hostname that is taken", async () => {
    const dup = await createHub({ slug: SLUG, name: "Again", hostname: `other-${run}.localhost`, admin_email: "a@example.test", hub_kind: "other" });
    expect(dup.status).toBe(409);
    const host = await createHub({ slug: `other-${run}`, name: "Again", hostname: HOST, admin_email: "a@example.test", hub_kind: "other" });
    expect(host.status).toBe(409);
  });

  it("lists it", async () => {
    const hubs = await operator<Array<{ id: string }>>("listHubs");
    expect(hubs.map((h: { id: string }) => h.id)).toContain(SLUG);
  });
});

describe("edit a hub", () => {
  it("a name change needs no fresh code, and reaches the site and the emails on a demo hub", async () => {
    const res = await updateHub(SLUG, { name: "Renamed Test Hub" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.name).toBe("Renamed Test Hub");
    // The followers that still read the old name follow (review R11); the
    // operator the form set to something else stays.
    expect(res.body.follow_on.carried).toEqual({ "identity.name": "Renamed Test Hub", "email.from_name": "Renamed Test Hub" });
    expect(res.body.message).toContain("Hub name, Email from name");
    expect(res.body.handover.values["legal.operator_name"]).toBe("the Testing Moderators");
    const site = await call("GET", "/hub-config", HOST);
    expect(site.body.settings["identity.name"]).toBe("Renamed Test Hub");
    expect(res.body.plan).toMatchObject({ before: { name: "Console Test Hub" }, changes: { name: "Renamed Test Hub" }, needs_step_up: false });
  });

  it("a hostname change asks the console for a fresh code; the hub moves and the old hostname stays taken", async () => {
    const moved = `ctl-moved-${run}.localhost`;
    const res = await updateHub(SLUG, { hostname: moved });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.plan.needs_step_up).toBe(true);
    expect((await call("GET", "/hub-config", moved)).body.hub.id).toBe(SLUG);

    const reuse = await createHub({ slug: `reuse-${run}`, name: "Reuse", hostname: HOST, admin_email: "a@example.test", hub_kind: "other" });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toContain("stays taken");
    expect(res.body.config.previous_hostnames).toContain(HOST);
  });

  it("does not change a hub's mode: that is its admins' (review R10, session 4)", async () => {
    for (const mode of ["beta", "demo"]) {
      const res = await updateHub(SLUG, { mode });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("Hub settings → Mode");
    }
    expect((await hubDetail(SLUG)).body.hub.mode).toBe("demo");
  });

  it("refuses a hostname that is not one", async () => {
    const bad = await updateHub(SLUG, { hostname: "Not A Host" });
    expect(bad.status).toBe(409);
  });
});

describe("plugins and admins", () => {
  it("shows plugins: after create they are the hub's admins' (review R10)", async () => {
    const detail = (await hubDetail(SLUG)).body;
    expect(detail.plugins.find((p: { id: string }) => p.id === "wordcloud")).toMatchObject({ enabled: true });
  });

  it("adds an admin and emails them; removes one; never empties the list", async () => {
    const first = `first-admin-${run}@example.test`;
    const second = `second-admin-${run}@example.test`;
    const add = await setAdmins(SLUG, { admins: [first, second] });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.admins).toEqual([first, second]);
    // Only the one added gets the invite (review R38).
    expect(add.body.invites).toEqual({ sent: [second], not_sent: [] });

    const removed = await setAdmins(SLUG, { admins: [second] });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.admins).toEqual([second]);

    const empty = await setAdmins(SLUG, { admins: [] });
    expect(empty.status).toBe(400);
  });
});

describe("archive", () => {
  const slug = `ctl-arch-${run}`;
  const host = `ctl-arch-${run}.localhost`;

  beforeAll(async () => {
    const res = await createHub({ slug, name: "Archive Me", hostname: host, admin_email: "a@example.test", hub_kind: "other" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
  });

  it("suspends the hub and keeps its slug and hostname taken", async () => {
    const res = await archiveHub(slug);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub.status).toBe("suspended");
    expect(res.body.hub.archived_at).toBeTruthy();

    expect((await call("GET", "/hub-config", host)).status).toBe(503);

    const again = await createHub({ slug, name: "Again", hostname: `fresh-${run}.localhost`, admin_email: "a@example.test", hub_kind: "other" });
    expect(again.status).toBe(409);
    expect(again.body.error).toContain("archived");
    const sameHost = await createHub({ slug: `fresh-${run}`, name: "Again", hostname: host, admin_email: "a@example.test", hub_kind: "other" });
    expect(sameHost.status).toBe(409);
    expect(sameHost.body.error).toContain("archived");
    // Archiving twice is refused.
    expect((await archiveHub(slug)).status).toBe(400);
  });

  it("unarchive clears archived_at and leaves the hub suspended", async () => {
    const res = await unarchiveHub(slug);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.hub).toMatchObject({ archived_at: null, status: "suspended" });
  });

});

// Session 4 (2026-10-08): handing a hub over.
describe("handover", () => {
  const slug = `ctl-ho-${run}`;
  const oldHost = `ctl-ho-old-${run}.localhost`;
  const newHost = `ctl-ho-new-${run}.localhost`;

  beforeAll(async () => {
    const res = await createHub({ slug, name: "Handover Hub", hostname: oldHost, admin_email: `ho-${run}@example.test`, hub_kind: "other" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(slug);
  });

  it("edits what residents see while the hub is a demo; a new hub name carries", async () => {
    const res = await updateHandover(slug, {
        values: {
          "identity.name": "Handed Over Hub",
          "legal.who_runs_this": "Run by the volunteers of the Handed Over Hub.",
          "email.postal_address": "PO Box 9",
        },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The from-name still reads the old name, so it follows; the registry name too. No operator was set.
    expect(res.body.follow_on.carried).toEqual({
      "email.from_name": "Handed Over Hub",
      "hubs.name": "Handed Over Hub",
    });
    expect(res.body.hub.name).toBe("Handed Over Hub");
    expect(res.body.handover.values["email.postal_address"]).toBe("PO Box 9");
    expect(res.body.handover.changed["email.postal_address"].by).toBe(`console:${OPERATOR}`);
    const site = await call("GET", "/hub-config", oldHost);
    expect(site.body.settings["identity.name"]).toBe("Handed Over Hub");
    expect(site.body.settings["legal.operator_name"]).toBeUndefined();
  });

  it("refuses a bad value in plain words, and a key that is not the panel's", async () => {
    const bad = await updateHandover(slug, { values: { "legal.contact_email": "nope" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/^Contact address/);
    const other = await updateHandover(slug, { values: { "people.admin_emails": "[]" } });
    expect(other.status).toBe(400);
  });

  it("moving the hub keeps the old address working: pages and API redirect, the page shell gets hub_moved", async () => {
    const res = await updateHub(slug, { hostname: newHost });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.config.previous_hostnames).toEqual([oldHost]);

    const page = await rawGet("/process/abc?ref=share", oldHost);
    expect(page.status).toBe(301);
    expect(page.location).toMatch(new RegExp(`^http://${newHost.replace(/\./g, "\\.")}(:\\d+)?/process/abc\\?ref=share$`));

    const shell = await call("GET", "/hub-config", oldHost);
    expect(shell.status).toBe(404);
    expect(shell.body.code).toBe("hub_moved");
    expect(shell.body.location).toMatch(new RegExp(`^http://${newHost.replace(/\./g, "\\.")}`));

    expect((await call("GET", "/hub-config", newHost)).body.hub.id).toBe(slug);
  });

  it("once the hub's admins move it out of demo, the panel is read-only and a rename says what it did not change", async () => {
    // The hub's own Settings → Mode does this with a fresh code; the row is set directly here.
    await localRest(`hubs?id=eq.${slug}`, { method: "PATCH", body: JSON.stringify({ mode: "beta" }) });
    const detail = (await hubDetail(slug)).body;
    expect(detail.handover.editable).toBe(false);

    const refused = await updateHandover(slug, { values: { "email.from_name": "X" } });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("left demo");

    const renamed = await updateHub(slug, { name: "Registry Only" });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.follow_on.carried).toEqual({});
    expect(renamed.body.message).toContain("Only the registry name changed");
    expect((await call("GET", "/hub-config", newHost)).body.settings["identity.name"]).toBe("Handed Over Hub");
  });

  it("names refreshed samples by title", async () => {
    const demo = `ctl-smp-${run}`;
    const res = await createHub({ slug: demo, name: "Sample Titles", hostname: `${demo}.localhost`, admin_email: `s-${run}@example.test`, hub_kind: "organization" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created.push(demo);
    const refreshed = await refreshSamples(demo);
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    const titles = refreshed.body.titles as Record<string, string>;
    expect(Object.keys(titles).length).toBeGreaterThan(10);
    for (const key of refreshed.body.refresh.added as string[]) expect(titles[key], key).toBeTruthy();
    expect(Object.values(titles).some((t) => /\{[A-Z_]+\}/.test(t))).toBe(false);
  });
});
