import { describe, expect, it } from "vitest";
import { refuseRemote } from "../setup/e2eGuard.js";

describe("the E2E guard (playwright.config.ts)", () => {
  it("lets a run on this machine through, with or without the variables", () => {
    expect(() => refuseRemote({})).not.toThrow();
    expect(() =>
      refuseRemote({
        CIVIC_E2E_BASE_URL: "http://localhost:4173",
        CIVIC_E2E_API_BASE: "http://shots.localhost:4173/api",
        CIVIC_API_BASE: "http://127.0.0.1:3000",
      }),
    ).not.toThrow();
  });

  it("refuses a page or API base that is not this machine", () => {
    expect(() => refuseRemote({ CIVIC_E2E_BASE_URL: "https://floyd.dev.civic.social" })).toThrow(/CIVIC_E2E_BASE_URL/);
    expect(() => refuseRemote({ CIVIC_E2E_API_BASE: "https://floyd.dev.civic.social/api" })).toThrow(/CIVIC_E2E_API_BASE/);
    expect(() => refuseRemote({ CIVIC_API_BASE: "https://civic-hub-dev.vercel.app" })).toThrow(/CIVIC_API_BASE/);
    // A name that only starts like localhost is not this machine.
    expect(() => refuseRemote({ CIVIC_E2E_API_BASE: "http://localhost.example.com" })).toThrow();
  });

  it("runs elsewhere only when asked in so many words", () => {
    expect(() => refuseRemote({ CIVIC_E2E_REMOTE: "yes", CIVIC_E2E_BASE_URL: "https://floyd.dev.civic.social" })).not.toThrow();
    expect(() => refuseRemote({ CIVIC_E2E_REMOTE: "1", CIVIC_E2E_BASE_URL: "https://floyd.dev.civic.social" })).toThrow();
  });
});
