// The console's fresh codes (plugin session 2). On dev the operator's first
// code request for each catalog action was refused (a code had been emailed
// under a minute before: the sign-in's, or the last action's, already used),
// the dialog said a code was on its way, and each refused request still
// counted against the IP's five an hour until no code came at all. Now:
//   - the first step-up request right after a sign-in code sends one;
//   - a second while that step-up code waits unused is refused, with the time;
//   - a refused request counts nothing against the IP.
// Local stack only (it reads and clears the operator's codes and buckets).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consoleCall, mintConsoleSession, OPERATOR } from "../fixtures/consoleCall.js";
import { localRest } from "../fixtures/adminSession.js";
import { freshTestIp } from "../fixtures/helpers.js";
import { rateLimitBucket } from "../../src/db/rateLimit.js";

const op = encodeURIComponent(OPERATOR);

async function codes(purpose: string): Promise<number> {
  return ((await localRest(`platform_sign_in_codes?select=id&realm=eq.console&purpose=eq.${purpose}&email=eq.${op}`)) as unknown[]).length;
}

async function hits(scope: string, by: string, value: string): Promise<number> {
  return ((await localRest(`rate_limit_hits?select=id&bucket=eq.${encodeURIComponent(rateLimitBucket(scope, by, value))}`)) as unknown[]).length;
}

/** The operator with no codes waiting and no recent code emails, as after a quiet hour. */
async function quiet(): Promise<void> {
  await localRest(`platform_sign_in_codes?realm=eq.console&email=eq.${op}`, { method: "DELETE" });
  for (const scope of ["console.code_email", "console.new_code"]) {
    await localRest(`rate_limit_hits?bucket=like.${encodeURIComponent(`${scope}:email:`)}*`, { method: "DELETE" });
  }
}

let cookie = "";
beforeAll(async () => {
  await quiet();
  cookie = await mintConsoleSession();
});
afterAll(quiet);

describe("the console's fresh codes", () => {
  it("the first step-up request right after a sign-in code sends one; a second while it waits is refused; a refused request counts nothing", async () => {
    const ip = freshTestIp();
    const signIn = await consoleCall("POST", "/control/auth/request-code", { body: { email: OPERATOR }, ip });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);
    expect(await codes("sign_in")).toBe(1);

    // At once, as an operator who signed in and pressed Approve.
    const first = await consoleCall("POST", "/control/auth/step-up/request-code", { cookie, body: {}, ip });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await codes("step_up")).toBe(1);
    expect(await hits("console.request_code", "ip", ip)).toBe(2);

    // While that code waits unused, the minute between emails holds, and says when.
    const second = await consoleCall("POST", "/control/auth/step-up/request-code", { cookie, body: {}, ip });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("code_throttled");
    expect(String(second.body.error)).toMatch(/^We just sent you a code\. You can ask for another after /);
    expect(await codes("step_up")).toBe(1);
    // ...and it was not counted against the IP's five an hour.
    expect(await hits("console.request_code", "ip", ip)).toBe(2);
  });
});

// One fresh code confirms the catalog's actions for ten minutes on the
// session that entered it (ADR-015), each still audited; anything else, and
// another session, still needs its own code. On the straw poll's entry (in
// the catalog, loaded by no deployment), left withdrawn.
describe("one code confirms catalog actions for ten minutes", () => {
  const STRAW = "@civic-social-examples/plugin-straw-poll";
  const sha = async (v: string) => (await import("node:crypto")).createHash("sha256").update(v).digest("hex");

  async function stepCode(): Promise<string> {
    const code = String(100000 + Math.floor(Math.random() * 899999));
    const { plantCode } = await import("../fixtures/consoleCall.js");
    await plantCode("step_up", code);
    return code;
  }

  it("the first catalog action takes a code; the next ones on that session do not, each audited with how it was confirmed", async () => {
    const session = await mintConsoleSession();
    const view = await consoleCall("GET", "/control/plugins", { cookie: session });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.confirmed_until).toBeNull();
    const entry = view.body.entries.find((e: { package: string }) => e.package === STRAW);
    expect(entry, "the straw poll's entry is in the catalog").toBeTruthy();
    // Make it approvable whatever an earlier run left: withdrawn or pending.
    const act = (name: string, body: Record<string, unknown> = {}, cookie = session) =>
      consoleCall("POST", `/control/plugins/${entry.id}/${name}`, { cookie, body });
    const [first, second, third] = entry.status === "approved" ? ["withdraw", "approve", "withdraw"] : ["approve", "withdraw", "approve"];

    expect((await act(first)).status).toBe(403);
    const coded = await act(first, { step_up_code: await stepCode() });
    expect(coded.status, JSON.stringify(coded.body)).toBe(200);
    const until = Date.parse(coded.body.confirmed_until);
    expect(until - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    expect((await act(second)).status).toBe(200);
    expect((await act(third)).status).toBe(200);
    const audit = (await localRest(
      `control_audit_log?select=action,after&action=in.(plugin.approve,plugin.withdraw)&after->>id=eq.${entry.id}&order=id.desc&limit=3`,
    )) as Array<{ action: string; after: { confirmed: string } }>;
    expect(audit.reverse().map((r) => [r.action.split(".")[1], r.after.confirmed])).toEqual([
      [first, "code"],
      [second, "window"],
      [third, "window"],
    ]);

    // Another session needs its own code; so does anything that is not the catalog's
    // (archiving a hub made for this, which the run's teardown deletes).
    expect((await act(third === "approve" ? "withdraw" : "approve", {}, await mintConsoleSession())).status).toBe(403);
    const slug = `ccw-${Date.now().toString(36)}`;
    const made = await consoleCall("POST", "/control/hubs", {
      cookie: session,
      body: { slug, name: "Window Check", hostname: `${slug}.localhost`, admin_email: "a@example.test", hub_kind: "other" },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const archive = await consoleCall("POST", `/control/hubs/${slug}/archive`, { cookie: session, body: {} });
    expect(archive.status).toBe(403);
    expect(archive.body.error).toBe("step_up_required");

    // When the ten minutes are over, a code again.
    const token = decodeURIComponent(session.split("=")[1]!);
    await localRest(`control_sessions?token_hash=eq.${await sha(token)}`, {
      method: "PATCH",
      body: JSON.stringify({ catalog_confirmed_until: new Date(Date.now() - 1000).toISOString() }),
    });
    const after = await act(third === "approve" ? "withdraw" : "approve");
    expect(after.status).toBe(403);
    // Leave it withdrawn.
    if (third === "approve") expect((await act("withdraw", { step_up_code: await stepCode() })).status).toBe(200);
  });
});
