import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPolisAdapter } from "../../src/shared/polis_deliberation/adapter/polisAdapter";

/**
 * Regression cover for the failure that wedged proc_5889e8e441d1495e on
 * 2026-09-04: an approved conversation stuck at "waiting to start", an orphaned
 * Polis conversation, and a live participant JWT rendered onto the page.
 */

const CONV = { url: "https://polis.example/5fm62xv5ma" };

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const adapter = () =>
  createPolisAdapter({ baseUrl: "https://polis.example", authToken: "t" });

describe("polis adapter — writes are never retried", () => {
  it("does not retry a POST that timed out", async () => {
    // A client-side abort says nothing about whether the server applied the
    // write. Retrying is what produced the duplicate-comment 409.
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValue(abort);

    await expect(adapter().createDeliberation({ topic: "t", description: "d" }))
      .rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries a GET that timed out", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValue(abort);

    await expect(adapter().getStatements("5fm62xv5ma")).rejects.toThrow();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("polis adapter — a seed failure never loses the conversation", () => {
  it("returns the conversation id even when a seed statement fails", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, CONV))
      .mockResolvedValueOnce(res(500, { error: "boom" }));

    const out = await adapter().createDeliberation({
      topic: "t",
      description: "d",
      seed_statements: ["one"],
    });
    // The orphan bug: the id existed on Polis and never reached the hub.
    expect(out.conversation_id).toBe("5fm62xv5ma");
  });

  it("treats a duplicate statement as already posted", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, CONV))
      .mockResolvedValueOnce(res(409, { error: "polis_err_post_comment_duplicate" }))
      .mockResolvedValueOnce(res(200, {}));

    const out = await adapter().createDeliberation({
      topic: "t",
      description: "d",
      seed_statements: ["already there", "new one"],
    });
    expect(out.conversation_id).toBe("5fm62xv5ma");
  });
});

describe("polis adapter — errors never carry the upstream body", () => {
  it("keeps the Polis auth token out of the thrown message", async () => {
    // Polis mints a participant JWT into its error responses. The old message
    // interpolated the whole body, so a 409 rendered a live one-year token
    // for the hub owner's own account onto the conversation page.
    const leaky = {
      error: "polis_err_post_comment_duplicate",
      status: 409,
      auth: { token: "eyJhbGciOiJSUzI1NiJ9.SECRET.sig", token_type: "Bearer" },
    };
    fetchMock.mockResolvedValue(res(409, leaky));

    await expect(
      adapter().createDeliberation({ topic: "t", description: "d" }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("eyJ"),
      }),
    );
  });

  it("carries the status and code as fields instead", async () => {
    fetchMock.mockResolvedValue(res(409, { error: "polis_err_post_comment_duplicate" }));
    await adapter()
      .createDeliberation({ topic: "t", description: "d" })
      .catch((e) => {
        expect(e.status).toBe(409);
        expect(e.polisCode).toBe("polis_err_post_comment_duplicate");
      });
  });
});
