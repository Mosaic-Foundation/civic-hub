// The operator command for self-hosters (scripts/lib/operatorCli.ts): the
// console's actions through the operator API, with the self-hoster's own
// catalog key. The hub here is a fake transport that records each call; the
// signature checks are the hub's own (src/plugins/signature.ts).

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogKeys, signatureVerifies } from "../../src/plugins/signature.js";
import { hubBase, httpTransport, parsePairs, runOperatorCli, type OperatorResponse, type Transport } from "../../scripts/lib/operatorCli.js";

const TEST_PEM = readFileSync(join(__dirname, "../fixtures/catalog/test-signing-key.pem"), "utf8");
const HASH = `sha256:${"b".repeat(64)}`;

interface Run {
  code: number;
  out: string[];
  err: string[];
  calls: Array<{ method: string; args: unknown[] }>;
}

function fakeHub(answers: Record<string, (args: unknown[]) => unknown>): { transport: Transport; calls: Run["calls"] } {
  const calls: Run["calls"] = [];
  const transport: Transport = async (method, args) => {
    calls.push({ method, args });
    const answer = answers[method];
    if (!answer) return { status: 404, body: { error: `No operator method "${method}".`, code: "not_found" } };
    try {
      return { status: 200, body: answer(args) ?? null };
    } catch (e) {
      return { status: 400, body: { error: (e as Error).message, code: "invalid_request" } };
    }
  };
  return { transport, calls };
}

async function run(
  argv: string[],
  answers: Record<string, (args: unknown[]) => unknown>,
  opts: { env?: Record<string, string>; confirm?: boolean } = {},
): Promise<Run> {
  const { transport, calls } = fakeHub(answers);
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOperatorCli(argv, {
    env: { CIVIC_OPERATOR_URL: "https://hubs.example.org", CIVIC_OPERATOR_NAME: "sam@example.org", ...opts.env },
    transport,
    io: { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => opts.confirm ?? true },
  });
  return { code, out, err, calls };
}

function keyFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "operator-cli-"));
  return join(dir, "catalog-key.pem");
}

function pendingEntry(id = "3f2a9c11-0000-4000-8000-000000000001") {
  return {
    id,
    package: "@example/civic-petition",
    version: "1.0.0",
    hash: HASH,
    display_name: "Petitions",
    capabilities: { tables: [], routes: [] } as never,
    status: "pending",
    signed: false,
    signature_key: null,
    required: false,
    matches_deployment: true,
    grant: { can: ["Keep petitions"], cannot: ["Read votes"] },
  };
}

describe("the operator command's settings", () => {
  it("refuses a plain-http address that is not this computer, and accepts https and localhost", () => {
    expect(() => hubBase("http://hubs.example.org")).toThrow(/https/);
    expect(hubBase("https://hubs.example.org").host).toBe("hubs.example.org");
    expect(hubBase("http://localhost:3000").port).toBe("3000");
    expect(() => hubBase(undefined)).toThrow(/CIVIC_OPERATOR_URL/);
  });

  it("asks for the token before calling the hub", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOperatorCli(["hubs"], {
      env: { CIVIC_OPERATOR_URL: "https://hubs.example.org" },
      io: { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => true },
    });
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/CIVIC_OPERATOR_TOKEN/);
  });

  it("reads key=value pairs, with true/false and JSON as values", () => {
    expect(parsePairs(["name=Bel Air", "sample_content=true", 'plugins={"civic.vote":false}'])).toEqual({
      name: "Bel Air",
      sample_content: true,
      plugins: { "civic.vote": false },
    });
    expect(() => parsePairs(["name"])).toThrow(/key=value/);
  });
});

describe("the HTTP transport", () => {
  it("posts { args } with the token as a bearer and answers the result", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ result: [{ id: "bel-air" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = httpTransport(new URL("https://hubs.example.org/base"), "tok", fetchImpl);
    const res: OperatorResponse = await t("listHubs", []);
    expect(res).toEqual({ status: 200, body: [{ id: "bel-air" }] });
    expect(seen[0].url).toBe("https://hubs.example.org/base/operator/rpc/listHubs");
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ args: [] });
  });

  it("explains a deployment with no operator API", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })) as unknown as typeof fetch;
    const res = await httpTransport(new URL("https://hubs.example.org"), "tok", fetchImpl)("listHubs", []);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/CIVIC_OPERATOR_TOKEN is unset/);
  });
});

describe("the catalog key", () => {
  it("key new writes an owner-only key, prints its public half, and never overwrites", async () => {
    const file = keyFile();
    const made = await run(["key", "new", file], {});
    expect(made.code).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const line = made.out.find((l) => l.includes("CIVIC_CATALOG_PUBLIC_KEY="))!;
    const publicKey = line.split("=")[1];
    const hub = catalogKeys({ mode: "required", publicKey, production: true });
    expect(hub.primary?.publicKey).toBe(publicKey);

    const again = await run(["key", "new", file], {});
    expect(again.code).toBe(2);
    expect(again.err.join("\n")).toMatch(/never overwritten/);
  });

  it("refuses the committed test key against a deployment", async () => {
    const r = await run(["approve", "3f2a"], { catalog: () => ({ entries: [pendingEntry()], signing: { mode: "required", key: null } }) }, {
      env: { CIVIC_CATALOG_SIGNING_KEY: TEST_PEM },
    });
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toMatch(/committed test key/);
  });
});

describe("approving a plugin", () => {
  it("signs the entry with the self-hoster's key, which the hub then verifies", async () => {
    const file = keyFile();
    const made = await run(["key", "new", file], {});
    const publicKey = made.out.find((l) => l.includes("CIVIC_CATALOG_PUBLIC_KEY="))!.split("=")[1];
    const hub = catalogKeys({ mode: "required", publicKey, production: true });
    const entry = pendingEntry();

    const r = await run(
      ["approve", "3f2a", "--notes", "read the code"],
      {
        catalog: () => ({ entries: [entry], signing: { mode: "required", key: { id: hub.primary!.id, public_key: publicKey } } }),
        approveEntry: ([id, by, notes, sig]) => {
          expect(signatureVerifies({ ...entry, ...(sig as object) }, hub.trusted)).toBe(true);
          return { before: entry, after: { ...entry, id, status: "approved", approved_by: by, notes } };
        },
      },
      { env: { CIVIC_CATALOG_SIGNING_KEY_FILE: file } },
    );
    expect(r.code, r.err.join("\n")).toBe(0);
    const call = r.calls.find((c) => c.method === "approveEntry")!;
    expect(call.args.slice(0, 3)).toEqual([entry.id, "sam@example.org", "read the code"]);
    expect(r.out.join("\n")).toMatch(/can: Keep petitions/);
  });

  it("stops before approving when the hub trusts another key", async () => {
    const file = keyFile();
    await run(["key", "new", file], {});
    const r = await run(
      ["approve", "3f2a"],
      { catalog: () => ({ entries: [pendingEntry()], signing: { mode: "required", key: { id: "ed25519:0000000000000000", public_key: "x" } } }) },
      { env: { CIVIC_CATALOG_SIGNING_KEY_FILE: file } },
    );
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/Set the deployment's CIVIC_CATALOG_PUBLIC_KEY to/);
    expect(r.calls.map((c) => c.method)).not.toContain("approveEntry");
  });

  it("needs a key when the deployment requires signatures", async () => {
    const r = await run(["approve", "3f2a"], { catalog: () => ({ entries: [pendingEntry()], signing: { mode: "required", key: null } }) });
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toMatch(/requires signed approvals/);
  });

  it("changes nothing when the answer at the prompt is no", async () => {
    const r = await run(
      ["approve", "3f2a"],
      { catalog: () => ({ entries: [pendingEntry()], signing: { mode: "off", key: null } }) },
      { confirm: false },
    );
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/Nothing changed/);
    expect(r.calls.map((c) => c.method)).toEqual(["catalog"]);
  });

  it("asks for more of an id that two entries share", async () => {
    const r = await run(["withdraw", "3f2a"], {
      catalog: () => ({ entries: [pendingEntry(), pendingEntry("3f2a9c11-0000-4000-8000-000000000002")], signing: { mode: "off", key: null } }),
    });
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/give more of it/);
  });

  it("sign-approved signs only the approved entries its key has not signed", async () => {
    const file = keyFile();
    const made = await run(["key", "new", file], {});
    const publicKey = made.out.find((l) => l.includes("CIVIC_CATALOG_PUBLIC_KEY="))!.split("=")[1];
    const hub = catalogKeys({ mode: "required", publicKey, production: true });
    const id = hub.primary!.id;
    const entries = [
      { ...pendingEntry("a1"), status: "approved", signed: false },
      { ...pendingEntry("a2"), status: "approved", signed: true, signature_key: id },
      { ...pendingEntry("a3"), status: "pending" },
    ];
    const r = await run(
      ["sign-approved", "--yes"],
      {
        catalog: () => ({ entries, signing: { mode: "required", key: { id, public_key: publicKey } } }),
        storeSignatures: ([items]) => {
          for (const it of items as Array<{ id: string; signature: string; signature_key: string }>) {
            const row = entries.find((e) => e.id === it.id)!;
            expect(signatureVerifies({ ...row, ...it }, hub.trusted)).toBe(true);
          }
          return (items as Array<{ id: string }>).map((i) => ({ id: i.id }));
        },
      },
      { env: { CIVIC_CATALOG_SIGNING_KEY_FILE: file } },
    );
    expect(r.code, r.err.join("\n")).toBe(0);
    const stored = r.calls.find((c) => c.method === "storeSignatures")!.args[0] as Array<{ id: string }>;
    expect(stored.map((s) => s.id)).toEqual(["a1"]);
  });
});

describe("hubs", () => {
  it("create checks the form with the hub, makes the hub, adds the word cloud and invites its admins", async () => {
    const input = { slug: "bel-air", name: "Bel Air", hostname: "bel-air.example.org", admins: ["ana@example.org"], mode: "live", sampleContent: false };
    const r = await run(["create", "slug=bel-air", "name=Bel Air", "hostname=bel-air.example.org", "admin_email=ana@example.org", "mode=live"], {
      parseCreate: ([form]) => {
        expect(form).toMatchObject({ slug: "bel-air", admin_email: "ana@example.org" });
        return input;
      },
      createHub: () => ({ hub: { id: "bel-air" }, settings: {} }),
      addStarterWordcloud: () => ({ added: true }),
      inviteAdmins: () => ({ report: {}, message: "Invited ana@example.org." }),
    });
    expect(r.code, r.err.join("\n")).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(["parseCreate", "createHub", "addStarterWordcloud", "inviteAdmins"]);
    expect(r.calls[1].args[1]).toEqual({ allowedModes: ["demo", "beta", "live"], updatedBy: "console:sam@example.org" });
    expect(r.out.join("\n")).toMatch(/Invited ana@example.org/);
  });

  it("passes the hub's refusal through in its own words", async () => {
    const r = await run(["create", "slug=admin"], {
      parseCreate: () => {
        throw new Error('"admin" is reserved.');
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/The hub refused \(400, invalid_request\): "admin" is reserved\./);
  });

  it("config shows the change, then applies what the hub checked", async () => {
    const r = await run(["config", "bel-air", "name=Bel Air Town"], {
      planConfig: () => ({ changes: { name: "Bel Air Town" }, before: { name: "Bel Air" }, needs_step_up: false }),
      applyConfig: () => ({ changes: { name: "Bel Air Town" }, follow_on: null, message: null }),
    });
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe("  name: Bel Air -> Bel Air Town");
    expect(r.calls[1]).toEqual({ method: "applyConfig", args: ["bel-air", { name: "Bel Air Town" }, "sam@example.org"] });
  });

  it("admins sets the roster and invites only the new ones", async () => {
    const r = await run(["admins", "bel-air", "ana@example.org", "ben@example.org"], {
      planAdmins: () => ({ before: ["ana@example.org", "old@example.org"], next: ["ana@example.org", "ben@example.org"] }),
      setAdmins: () => null,
      inviteAdmins: () => ({ report: {}, message: null }),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Remove: old@example.org");
    expect(r.calls.find((c) => c.method === "inviteAdmins")!.args).toEqual(["bel-air", ["ben@example.org"]]);
  });

  it("hubs lists them, and --json prints the hub's answer", async () => {
    const hubs = [{ id: "bel-air", name: "Bel Air", hostname: "bel-air.example.org", mode: "live", archived_at: null }];
    const plain = await run(["hubs"], { listHubs: () => hubs });
    expect(plain.out[1]).toMatch(/^bel-air\s+Bel Air\s+bel-air\.example\.org\s+live$/);
    const json = await run(["hubs", "--json"], { listHubs: () => hubs });
    expect(JSON.parse(json.out.join("\n"))).toEqual(hubs);
  });
});
