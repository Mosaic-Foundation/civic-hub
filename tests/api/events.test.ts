/**
 * Activity collection endpoint tests — GET /events, GET /activities/:id.
 *
 * The hub's wire surface is an ActivityStreams 2.0 OrderedCollection per the
 * Civic Activity Specification v0.2 §6. These tests check the transport (the
 * collection, its pages, its filters and the serving rule); the shape of the
 * documents inside `orderedItems` is pinned by the golden tests in
 * tests/unit/activitySerializer.test.ts.
 *
 * GET /api/feed — the hub UI's internal read model — is covered at the bottom:
 * its payload must be byte-for-byte the shape the UI consumed before the
 * conversion.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  api,
  apiJson,
  ensureSeedData,
  type EventsResponse,
} from "../fixtures/helpers.js";

const AS2 = "https://www.w3.org/ns/activitystreams";
const CIVIC = "https://civic.social/ns/civic";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

interface Collection {
  "@context": unknown;
  id: string;
  type: string;
  totalItems?: number;
  first: string;
}

interface Page {
  "@context": unknown;
  id: string;
  type: string;
  partOf: string;
  orderedItems: Array<Record<string, any>>;
  next?: string;
}

/** Follow a `next`/`first` URL, which is absolute against the hub's BASE_URL. */
async function fetchUrl<T>(url: string): Promise<{ status: number; body: T }> {
  const res = await fetch(url);
  return { status: res.status, body: (await res.json()) as T };
}

describe("GET /events — the activity collection", () => {
  beforeAll(async () => {
    await ensureSeedData();
  });

  it("serves an OrderedCollection with a link to the first page", async () => {
    const res = await api("/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/activity+json");

    const body = (await res.json()) as Collection;
    expect(body["@context"]).toBe(AS2);
    expect(body.type).toBe("OrderedCollection");
    expect(body.id).toMatch(/\/events$/);
    expect(body.first).toContain("page=true");
    expect(typeof body.totalItems).toBe("number");
  });

  it("serves an OrderedCollectionPage whose items are valid Civic Activities", async () => {
    const { status, body } = await apiJson<Page>("/events?page=true");
    expect(status).toBe(200);
    expect(body.type).toBe("OrderedCollectionPage");
    expect(body["@context"]).toEqual([AS2, CIVIC]);
    expect(body.partOf).toMatch(/\/events$/);
    expect(Array.isArray(body.orderedItems)).toBe(true);
    expect(body.orderedItems.length).toBeGreaterThan(0);

    for (const activity of body.orderedItems) {
      // Spec §2.2 MUST-level properties.
      expect(activity["@context"]?.[0]).toBe(AS2);
      expect(activity["@context"]?.[1]).toBe(CIVIC);
      expect(String(activity.id)).toMatch(/^https?:\/\/.+\/activities\/.+/);
      expect(typeof activity.type).toBe("string");
      expect(String(activity.actor)).toMatch(/^(https?:\/\/|did:)/);
      expect(String(activity.published)).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
      expect(Array.isArray(activity.to)).toBe(true);
      expect(activity.to.length).toBeGreaterThan(0);
      expect(typeof activity.generator?.id).toBe("string");
      expect(activity.object).toBeDefined();
      // Process activities carry their linkage (§4).
      if (activity.context) {
        expect(activity.context.type).toBe("civic:Process");
        expect(String(activity.context.id)).toMatch(/\/process\//);
      }
      // No v0.1 envelope field survives on the wire.
      expect(activity).not.toHaveProperty("event_type");
      expect(activity).not.toHaveProperty("meta");
      expect(activity).not.toHaveProperty("data");
      expect(activity).not.toHaveProperty("source");
    }
  });

  it("orders items newest first", async () => {
    const { body } = await apiJson<Page>("/events?page=true");
    const times = body.orderedItems.map((a) => new Date(a.published).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it("pages: next walks the whole sequence without repeats or gaps", async () => {
    const { body: all } = await apiJson<Page>("/events?page=true&limit=200");
    const expected = all.orderedItems.map((a) => a.id);

    const seen: string[] = [];
    let url: string | undefined = `${new URL(all.id).origin}/events?page=true&limit=2`;
    let guard = 0;
    while (url && guard++ < 100) {
      const { body }: { body: Page } = await fetchUrl<Page>(url);
      expect(body.type).toBe("OrderedCollectionPage");
      seen.push(...body.orderedItems.map((a) => a.id));
      url = body.next;
    }

    expect(new Set(seen).size).toBe(seen.length); // no repeats
    expect(seen).toEqual(expected); // same sequence, same order
  });

  it("totalItems counts exactly the sequence the caller can page through", async () => {
    // The invariant that keeps the count honest: walk every page and compare.
    // Guards the SQL NULL trap — `NOT (meta->>visibility = 'restricted')` and
    // `NOT (process_id IN (…))` silently drop rows whose column is NULL, while
    // the page reads keep them, which would make totalItems undercount.
    const { body: collection } = await apiJson<Collection>("/events");
    let url: string | undefined = collection.first;
    let counted = 0;
    let guard = 0;
    while (url && guard++ < 100) {
      const { body }: { body: Page } = await fetchUrl<Page>(url);
      counted += body.orderedItems.length;
      url = body.next;
    }
    expect(collection.totalItems).toBe(counted);
  });

  it("clamps limit rather than rejecting it", async () => {
    const { status, body } = await apiJson<Page>("/events?page=true&limit=9999");
    expect(status).toBe(200);
    expect(body.orderedItems.length).toBeLessThanOrEqual(200);

    const zero = await apiJson<Page>("/events?page=true&limit=0");
    expect(zero.status).toBe(200);

    const nonsense = await apiJson<Page>("/events?page=true&limit=banana");
    expect(nonsense.status).toBe(200);
  });

  it("carries the filter set forward into next", async () => {
    const { body } = await apiJson<Page>("/events?page=true&limit=1&type=Create");
    expect(body.id).toContain("type=Create");
    expect(body.partOf).toContain("type=Create");
    if (body.next) {
      expect(body.next).toContain("type=Create");
      expect(body.next).toContain("limit=1");
      expect(body.next).toContain("cursor=");
    }
  });

  it("filters by activity type", async () => {
    const { body } = await apiJson<Page>("/events?page=true&limit=200&type=Create");
    expect(body.orderedItems.length).toBeGreaterThan(0);
    for (const activity of body.orderedItems) {
      expect(activity.type).toBe("Create");
    }
  });

  it("filters by context — process IRI and bare process id both work", async () => {
    const { body: firstPage } = await apiJson<Page>("/events?page=true");
    const withContext = firstPage.orderedItems.find((a) => a.context?.id);
    if (!withContext) return;
    const iri: string = withContext.context.id;
    const bareId = iri.slice(iri.lastIndexOf("/") + 1);

    const byIri = await apiJson<Page>(
      `/events?page=true&context=${encodeURIComponent(iri)}`,
    );
    const byId = await apiJson<Page>(`/events?page=true&context=${bareId}`);

    expect(byIri.body.orderedItems.length).toBeGreaterThan(0);
    expect(byIri.body.orderedItems.map((a) => a.id)).toEqual(
      byId.body.orderedItems.map((a) => a.id),
    );
    for (const activity of byIri.body.orderedItems) {
      expect(activity.context.id).toBe(iri);
    }
  });

  it("filters by since", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { status, body } = await apiJson<Page>(
      `/events?page=true&since=${encodeURIComponent(future)}`,
    );
    expect(status).toBe(200);
    expect(body.orderedItems).toEqual([]);
    expect(body.next).toBeUndefined();
  });

  it("an unmatched filter is an empty page, never an error", async () => {
    const { status, body } = await apiJson<Page>(
      "/events?page=true&type=NoSuchActivityType",
    );
    expect(status).toBe(200);
    expect(body.type).toBe("OrderedCollectionPage");
    expect(body.orderedItems).toEqual([]);

    const missingProcess = await apiJson<Page>(
      "/events?page=true&context=proc_does_not_exist",
    );
    expect(missingProcess.status).toBe(200);
    expect(missingProcess.body.orderedItems).toEqual([]);
  });

  it("withholds restricted activities from anonymous callers, silently", async () => {
    // Restricted events exist in the log (vote submissions, review
    // correspondence). Spec §5.2: an unauthorized caller gets a valid page
    // with them absent — never a 403, never a hint that they exist.
    const { status, body } = await apiJson<Page>("/events?page=true&limit=200");
    expect(status).toBe(200);
    for (const activity of body.orderedItems) {
      expect(activity.to).toContain(PUBLIC);
    }
  });
});

describe("GET /activities/:id", () => {
  beforeAll(async () => {
    await ensureSeedData();
  });

  it("dereferences the id an activity carries", async () => {
    const { body: page } = await apiJson<Page>("/events?page=true&limit=1");
    const activity = page.orderedItems[0];
    const { status, body } = await fetchUrl<Record<string, unknown>>(activity.id);
    expect(status).toBe(200);
    expect(body).toEqual(activity);
  });

  it("serves application/activity+json", async () => {
    const { body: page } = await apiJson<Page>("/events?page=true&limit=1");
    const res = await fetch(page.orderedItems[0].id);
    expect(res.headers.get("content-type")).toContain("application/activity+json");
  });

  it("404s for an unknown id", async () => {
    const { status } = await apiJson("/activities/evt_does_not_exist");
    expect(status).toBe(404);
  });
});

describe("GET /api/feed — the hub UI's internal read model", () => {
  beforeAll(async () => {
    await ensureSeedData();
  });

  it("still serves the internal { events, count } shape", async () => {
    const { status, body } = await apiJson<EventsResponse>("/feed");
    expect(status).toBe(200);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.count).toBe(body.events.length);

    for (const event of body.events.slice(0, 5)) {
      expect(event.id).toBeDefined();
      expect(event.version).toBeDefined();
      expect(event.event_type).toMatch(/^civic\./);
      expect(event.timestamp).toBeDefined();
      expect(event.process_id).toBeDefined();
      expect(event.actor).toBeDefined();
      expect(event.jurisdiction).toBeDefined();
      expect(event.source.hub_id).toBeDefined();
      expect(event.source.hub_url).toBeDefined();
      expect(event.meta.visibility).toBeDefined();
      expect(event.data).toBeDefined();
    }
  });

  it("is reachable at the same URL the UI uses in production", async () => {
    // On Vercel the /api prefix is stripped before Express sees the request,
    // so /api/feed and /feed are the same endpoint. Both must work locally.
    const direct = await apiJson<EventsResponse>("/feed");
    const prefixed = await apiJson<EventsResponse>("/api/feed");
    expect(prefixed.status).toBe(200);
    expect(prefixed.body.count).toBe(direct.body.count);
  });

  it("sorts descending by timestamp", async () => {
    const { body } = await apiJson<EventsResponse>("/feed");
    for (let i = 1; i < body.events.length; i++) {
      expect(new Date(body.events[i - 1].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(body.events[i].timestamp).getTime(),
      );
    }
  });

  it("keeps its process_id and event_type filters", async () => {
    const { body: all } = await apiJson<EventsResponse>("/feed");
    const processId = all.events[0].process_id;
    if (processId) {
      const { status, body } = await apiJson<EventsResponse>(
        `/feed?process_id=${processId}`,
      );
      expect(status).toBe(200);
      for (const event of body.events) expect(event.process_id).toBe(processId);
    }

    const { status, body } = await apiJson<EventsResponse>(
      "/feed?event_type=civic.process.created",
    );
    expect(status).toBe(200);
    expect(body.events.length).toBeGreaterThan(0);
    for (const event of body.events) {
      expect(event.event_type).toBe("civic.process.created");
    }
  });

  it("hides restricted events from anonymous callers", async () => {
    const { body } = await apiJson<EventsResponse>("/feed");
    for (const event of body.events) {
      expect(event.meta.visibility).not.toBe("restricted");
    }
  });
});
