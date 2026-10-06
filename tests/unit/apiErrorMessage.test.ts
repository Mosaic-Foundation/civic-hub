// The UI's message for a failed API response (2026-10-06): the sign-in form
// printed "[object Object]" for Vercel's firewall 403.
import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "../../ui/src/utils/httpError.js";

describe("apiErrorMessage", () => {
  it("passes the hub's own error text through", () => {
    expect(apiErrorMessage({ error: "Invalid or expired code" }, 400)).toBe("Invalid or expired code");
  });
  it("reads an error object, and says a 403 never reached the hub", () => {
    const vercel = { error: { code: "forbidden", message: "This request was blocked" } };
    expect(apiErrorMessage(vercel, 403)).toMatch(/blocked before it reached the hub/);
    expect(apiErrorMessage({ error: { message: "Too big" } }, 413)).toBe("Too big");
  });
  it("never prints an object", () => {
    for (const body of [null, {}, { error: {} }, { error: 3 }, "text"]) {
      expect(apiErrorMessage(body, 500, "Internal Server Error")).not.toMatch(/object Object/);
    }
    expect(apiErrorMessage(null, 403)).toMatch(/403/);
  });
});
