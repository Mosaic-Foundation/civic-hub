// The hub export bundle's format, with no database: what leaves and what
// does not, who owns which image and where it lands, the fingerprint, the
// archive, the bundle's self-check, and the importer's insert order.
// The round trip against a real database is tests/api/hubExportRoundTrip.test.ts.

import { describe, it, expect } from "vitest";
import {
  TABLE_KEYS,
  exportedTables,
  fingerprintTables,
  imageOwner,
  imageUrlNormalizer,
  isSecretSettingKey,
  omittedTables,
  publicObjectPrefix,
  targetImageKey,
  type Row,
} from "../../src/control/hubBundle/format.js";
import { exportHub, memorySink, ownedObjectKeys, type HubRowReader, type ObjectReader } from "../../src/control/hubBundle/export.js";
import { packTarGz, unpackTarGz } from "../../src/control/hubBundle/tar.js";
import { KEYS, KEY_ALIASES } from "../../src/models/hubSettings.js";
import { ImportRefused, checkBundle, connectFromEnv, insertOrder } from "../../scripts/lib/hubImport.js";

describe("what leaves", () => {
  it("has a key order for exactly the exported tables", () => {
    expect(Object.keys(TABLE_KEYS).sort()).toEqual(exportedTables().sort());
  });

  it("leaves the credentials and the cache behind, each with a reason", () => {
    const omitted = omittedTables();
    expect(omitted.map((o) => o.table).sort()).toEqual(["link_previews", "pending_verifications", "sessions"]);
    for (const o of omitted) expect(o.reason.length).toBeGreaterThan(10);
  });

  it("drops secret-shaped settings and no real setting", () => {
    for (const k of ["beta.demo_bypass_code", "demo_bypass_code", "plugin.conversation.auth_token", "plugin.x.api_key", "plugin.x.secret", "email.smtp_password"]) {
      expect(isSecretSettingKey(k), k).toBe(true);
    }
    const real = [...Object.values(KEYS), ...Object.keys(KEY_ALIASES), ...Object.values(KEY_ALIASES)];
    for (const k of real) expect(isSecretSettingKey(k), k).toBe(false);
    expect(isSecretSettingKey("plugin.news_sync.max_per_run")).toBe(false);
  });
});

describe("images: owner and landing key", () => {
  it("assigns owners by the build plan's rule", () => {
    expect(imageOwner("athens/2026/09/a.png", "floyd")).toEqual({ owner: "athens", rule: "hub-prefix" });
    expect(imageOwner("athens/identity/2026/09/a.png", "floyd")).toEqual({ owner: "athens", rule: "hub-prefix" });
    expect(imageOwner("hubs/athens/2026/09/a.png", "floyd")).toEqual({ owner: "athens", rule: "legacy-hubs-folder" });
    expect(imageOwner("2026/08/a.png", "floyd")).toEqual({ owner: "floyd", rule: "legacy-unprefixed" });
    expect(imageOwner("loose.png", "floyd")).toBeNull();
    expect(imageOwner("athens/../floyd/a.png", "floyd")).toBeNull();
  });

  it("lands every object under the hub's own prefix", () => {
    expect(targetImageKey("athens/2026/09/a.png", "athens", "hub-prefix")).toBe("athens/2026/09/a.png");
    expect(targetImageKey("hubs/athens/2026/09/a.png", "athens", "legacy-hubs-folder")).toBe("athens/identity/2026/09/a.png");
    expect(targetImageKey("2026/08/a.png", "floyd", "legacy-unprefixed")).toBe("floyd/2026/08/a.png");
  });

  it("lists the legacy unprefixed folders only for the migration-default hub", async () => {
    const all = ["floyd/2026/09/a.png", "2026/08/b.png", "2025/12/c.png", "hubs/floyd/2026/01/d.png", "athens/2026/09/e.png", "hubs/athens/2026/01/f.png"];
    const objects: ObjectReader = {
      storageBaseUrl: "https://src.example",
      bucket: "post-images",
      listTop: async () => ["2025", "2026", "athens", "floyd", "hubs"],
      listKeys: async (p) => all.filter((k) => k.startsWith(p)),
      download: async () => ({ bytes: Buffer.from(""), contentType: "image/png" }),
    };
    expect(await ownedObjectKeys(objects, "floyd")).toEqual(["2025/12/c.png", "2026/08/b.png", "floyd/2026/09/a.png", "hubs/floyd/2026/01/d.png"]);
    expect(await ownedObjectKeys(objects, "athens")).toEqual(["athens/2026/09/e.png", "hubs/athens/2026/01/f.png"]);
  });
});

describe("fingerprint", () => {
  const rows = [{ id: "b", n: 1, hub_id: "h" }, { id: "a", n: 2, hub_id: "h" }];

  it("ignores row order and key order", () => {
    const a = fingerprintTables([{ table: "t", rows }]);
    const b = fingerprintTables([{ table: "t", rows: [{ n: 2, hub_id: "h", id: "a" }, { hub_id: "h", id: "b", n: 1 }] }]);
    expect(a).toBe(b);
  });

  it("changes when a value changes, and ignores the derived search index", () => {
    const a = fingerprintTables([{ table: "processes", rows: [{ id: "p", title: "x" }] }]);
    expect(fingerprintTables([{ table: "processes", rows: [{ id: "p", title: "y" }] }])).not.toBe(a);
    expect(fingerprintTables([{ table: "processes", rows: [{ id: "p", title: "x", search_doc: "'x':1" }] }])).toBe(a);
  });

  it("equates an image URL on the old host with its rewrite on the new one", () => {
    const src = publicObjectPrefix("https://old.example", "post-images");
    const dst = publicObjectPrefix("http://127.0.0.1:54321", "post-images");
    const before = [{ id: "p", state: { banner: `${src}2026/08/a.png`, body: `see ${src}2026/08/a.png` } }];
    const after = [{ id: "p", state: { banner: `${dst}floyd/2026/08/a.png`, body: `see ${dst}floyd/2026/08/a.png` } }];
    const a = fingerprintTables([{ table: "processes", rows: before }], imageUrlNormalizer([{ url: `${src}2026/08/a.png`, sourceKey: "2026/08/a.png" }]));
    const b = fingerprintTables([{ table: "processes", rows: after }], imageUrlNormalizer([{ url: `${dst}floyd/2026/08/a.png`, sourceKey: "2026/08/a.png" }]));
    expect(a).toBe(b);
  });
});

describe("tar.gz", () => {
  it("round-trips files, including a path longer than 100 bytes", () => {
    const long = `civic-hub-export-athens-20260926T120000Z/images/athens/identity/2026/09/${"x".repeat(60)}.png`;
    const entries = [
      { path: "b/README.md", data: Buffer.from("hello") },
      { path: long, data: Buffer.alloc(1300, 7) },
      { path: "b/empty.jsonl", data: Buffer.alloc(0) },
    ];
    const back = unpackTarGz(packTarGz(entries));
    expect(back.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    expect(back[1].data.equals(entries[1].data)).toBe(true);
  });
});

// A hub in memory, exported by the real exporter.
function fakeHub() {
  const src = publicObjectPrefix("https://old.example", "post-images");
  const tables: Record<string, Row[]> = {
    users: [{ id: "u1", hub_id: "demo-x", email: "a@example.org" }],
    processes: [{ id: "p1", hub_id: "demo-x", title: "Parks", review_id: "r1", state: { banner_image_url: `${src}demo-x/2026/09/a.png` }, search_doc: "'park':1" }],
    process_reviews: [{ id: "r1", hub_id: "demo-x", process_id: "p1" }],
    hub_settings: [
      { hub_id: "demo-x", key: "identity.name", value: "Demo X" },
      { hub_id: "demo-x", key: "demo_bypass_code", value: "123456" },
    ],
  };
  const rows: HubRowReader = {
    kind: "supabase",
    hubRow: async (id) => (id === "demo-x" ? { id, name: "Demo X", hostname: "demo-x.localhost" } : null),
    tableRows: async (t) => tables[t] ?? [],
  };
  const objects: ObjectReader = {
    storageBaseUrl: "https://old.example",
    bucket: "post-images",
    listTop: async () => ["demo-x"],
    listKeys: async (p) => (p === "demo-x/" ? ["demo-x/2026/09/a.png"] : []),
    download: async () => ({ bytes: Buffer.from("PNGBYTES"), contentType: "image/png" }),
  };
  return { rows, objects };
}

describe("export → bundle self-check", () => {
  it("writes a bundle the importer accepts, without the secret setting or the search index", async () => {
    const { rows, objects } = fakeHub();
    const sink = memorySink();
    const m = await exportHub({ hubId: "demo-x", rows, objects, bucket: "post-images", sink, exportedBy: "test" });
    expect(m.excluded_settings.map((s) => s.key)).toEqual(["demo_bypass_code"]);
    expect(sink.files.get("tables/hub_settings.jsonl")!.toString()).not.toContain("123456");
    expect(sink.files.get("tables/processes.jsonl")!.toString()).not.toContain("search_doc");
    expect(m.images.count).toBe(1);
    expect(sink.files.get("README.md")!.toString()).toContain("demo_bypass_code");

    const b = checkBundle("x", sink.files);
    expect(b.tables.get("users")).toHaveLength(1);
  });

  it("refuses a tampered bundle", async () => {
    const { rows, objects } = fakeHub();
    const sink = memorySink();
    await exportHub({ hubId: "demo-x", rows, objects, bucket: "post-images", sink, exportedBy: "test" });
    sink.files.set("tables/users.jsonl", Buffer.from('{"id":"u1","hub_id":"demo-x","email":"evil@example.org"}\n'));
    expect(() => checkBundle("x", sink.files)).toThrow(ImportRefused);
  });

  it("refuses a bundle whose image bytes changed", async () => {
    const { rows, objects } = fakeHub();
    const sink = memorySink();
    await exportHub({ hubId: "demo-x", rows, objects, bucket: "post-images", sink, exportedBy: "test" });
    sink.files.set("images/demo-x/2026/09/a.png", Buffer.from("other"));
    expect(() => checkBundle("x", sink.files)).toThrow(ImportRefused);
  });
});

describe("insert order", () => {
  const fks = [
    { table: "processes", columns: ["hub_id", "review_id"], parent: "process_reviews", parentColumns: ["hub_id", "id"] },
    { table: "process_reviews", columns: ["hub_id", "process_id"], parent: "processes", parentColumns: ["hub_id", "id"] },
    { table: "review_turns", columns: ["review_id"], parent: "process_reviews", parentColumns: ["id"] },
    { table: "sessions", columns: ["user_id"], parent: "users", parentColumns: ["id"] },
  ];
  const nullable = (t: string, c: string) => t === "processes" && c === "review_id";

  it("puts parents first and breaks the processes ↔ reviews cycle at the nullable column", () => {
    const { order, deferred } = insertOrder(["review_turns", "process_reviews", "processes", "users"], fks, nullable);
    expect(deferred).toEqual([{ table: "processes", columns: ["review_id"] }]);
    expect(order.indexOf("processes")).toBeLessThan(order.indexOf("process_reviews"));
    expect(order.indexOf("process_reviews")).toBeLessThan(order.indexOf("review_turns"));
  });

  it("refuses a cycle it cannot break", () => {
    expect(() => insertOrder(["processes", "process_reviews"], fks, () => false)).toThrow(/cycle/);
  });
});

describe("database URL", () => {
  it("is refused on the command line", async () => {
    await expect(connectFromEnv("NOPE", ["node", "x", "postgres://u:p@h/db"])).rejects.toThrow(/env file/);
    await expect(connectFromEnv("NOPE", ["node", "x", "--db=postgresql://u:p@h/db"])).rejects.toThrow(/env file/);
  });
});
