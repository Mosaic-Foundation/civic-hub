// The operator command for self-hosters (scripts/operator.ts) against a
// running hub: the same HTTP door the console uses (/operator/rpc with
// CIVIC_OPERATOR_TOKEN). Makes a hub, reads it, changes a setting and the
// admins, refuses a reserved slug in the hub's words, and archives it.
// Signing is covered in tests/unit/operatorCli.test.ts. Both modes: the
// command never touches the database itself.

import { afterAll, describe, expect, it } from "vitest";
import { runOperatorCli } from "../../scripts/lib/operatorCli.js";
import { API_BASE } from "../fixtures/helpers.js";
import { OPERATOR_TOKEN, archiveHubs } from "../fixtures/operator.js";

const run = Date.now().toString(36);
const SLUG = `opc-${run}`;

afterAll(async () => {
  await archiveHubs([SLUG]);
});

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runOperatorCli([...argv, "--yes"], {
    env: { CIVIC_OPERATOR_URL: API_BASE, CIVIC_OPERATOR_TOKEN: OPERATOR_TOKEN, CIVIC_OPERATOR_NAME: "self-hoster@example.test" },
    io: { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => false },
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("the operator command against a running hub", () => {
  it("makes a hub, changes it, sets its admins and archives it", async () => {
    const made = await cli(
      "create",
      `slug=${SLUG}`,
      "name=Operator Command Town",
      `hostname=${SLUG}.localhost`,
      "admin_email=admin+opc@example.test",
      "mode=beta",
      "hub_kind=organization",
    );
    expect(made.code, made.err).toBe(0);
    expect(made.out).toContain(`Made ${SLUG}.`);

    const list = await cli("hubs", "--json");
    expect(list.code, list.err).toBe(0);
    expect((JSON.parse(list.out) as Array<{ id: string }>).map((h) => h.id)).toContain(SLUG);

    const config = await cli("config", SLUG, "name=Operator Command City");
    expect(config.code, config.err).toBe(0);
    expect(config.out).toContain("name: Operator Command Town -> Operator Command City");

    const admins = await cli("admins", SLUG, "admin+opc@example.test", "second+opc@example.test");
    expect(admins.code, admins.err).toBe(0);

    const detail = await cli("hub", SLUG, "--json");
    const d = JSON.parse(detail.out) as { hub: { name: string }; admins: string[] };
    expect(d.hub.name).toBe("Operator Command City");
    expect(d.admins).toEqual(["admin+opc@example.test", "second+opc@example.test"]);

    const archived = await cli("archive", SLUG);
    expect(archived.code, archived.err).toBe(0);
    const after = JSON.parse((await cli("hub", SLUG, "--json")).out) as { hub: { archived_at: string | null } };
    expect(after.hub.archived_at).not.toBeNull();
  });

  it("passes on the hub's refusal in its own words", async () => {
    const r = await cli("create", "slug=admin", "name=X", "hostname=x-opc.localhost", "admin_email=a@example.test", "mode=beta");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^The hub refused \(4\d\d/);
  });

  it("refuses a wrong token as the hub does", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOperatorCli(["hubs"], {
      env: { CIVIC_OPERATOR_URL: API_BASE, CIVIC_OPERATOR_TOKEN: "not-the-token" },
      io: { out: (l) => out.push(l), err: (l) => err.push(l), confirm: async () => false },
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/401/);
  });

  it("check reads the catalog's signing state", async () => {
    const r = await cli("check");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Reached the operator API/);
  });
});
