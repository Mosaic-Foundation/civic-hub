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
