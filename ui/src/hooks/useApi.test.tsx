import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { clearApiCache, useApi } from "./useApi";
import { request } from "../services/http";

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearApiCache();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useApi", () => {
  it("reads once and hands back the data", async () => {
    const fetcher = vi.fn().mockResolvedValue({ title: "A" });
    const { result } = renderHook(() => useApi("process/a", fetcher));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual({ title: "A" }));
    expect(result.current.loading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a new key starts empty: the previous record is never shown under it", async () => {
    const reads: Record<string, ReturnType<typeof deferred<{ id: string }>>> = { a: deferred(), b: deferred() };
    const { result, rerender } = renderHook(({ id }) => useApi(`process/${id}`, () => reads[id]!.promise), {
      initialProps: { id: "a" },
    });
    await act(async () => reads.a!.resolve({ id: "a" }));
    expect(result.current.data).toEqual({ id: "a" });

    rerender({ id: "b" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await act(async () => reads.b!.resolve({ id: "b" }));
    expect(result.current.data).toEqual({ id: "b" });
  });

  it("ignores a slow answer for a key it has moved on from (fast navigation)", async () => {
    const reads: Record<string, ReturnType<typeof deferred<{ id: string }>>> = { a: deferred(), b: deferred() };
    const signals: AbortSignal[] = [];
    const { result, rerender } = renderHook(
      ({ id }) =>
        useApi(`process/${id}`, (signal) => {
          signals.push(signal);
          return reads[id]!.promise;
        }),
      { initialProps: { id: "a" } },
    );
    rerender({ id: "b" });
    await act(async () => reads.b!.resolve({ id: "b" }));
    // A's answer arrives last; B stays.
    await act(async () => reads.a!.resolve({ id: "a" }));
    expect(result.current.data).toEqual({ id: "b" });
    expect(signals[0]!.aborted).toBe(true);
  });

  it("ignores an older reload that answers after a newer one", async () => {
    const answers = [deferred<number>(), deferred<number>(), deferred<number>()];
    let n = 0;
    const { result } = renderHook(() => useApi("count", () => answers[n++]!.promise));
    await act(async () => answers[0]!.resolve(0));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.reload();
    });
    act(() => {
      second = result.current.reload();
    });
    await act(async () => {
      answers[2]!.resolve(2);
      await second;
    });
    await act(async () => {
      answers[1]!.resolve(1);
      await first;
    });
    expect(result.current.data).toBe(2);
  });

  it("does nothing after unmount, and aborts the read", async () => {
    const read = deferred<string>();
    let signal: AbortSignal | undefined;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() =>
      useApi("x", (s) => {
        signal = s;
        return read.promise;
      }),
    );
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => read.resolve("late"));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("reads nothing for a null key", () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useApi(null, fetcher));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("shows the error, and keeps the data on screen while it reloads", async () => {
    let fail = true;
    const { result } = renderHook(() => useApi("p", () => (fail ? Promise.reject(new Error("down")) : Promise.resolve("ok"))));
    await waitFor(() => expect(result.current.error?.message).toBe("down"));
    fail = false;
    await act(async () => result.current.reload());
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("ok");
  });

  it("tries again before showing an error when asked to", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { result } = renderHook(() =>
      useApi("cold", () => (++calls < 3 ? Promise.reject(new Error("cold start")) : Promise.resolve("warm")), { retries: 2 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.data).toBe("warm");
    expect(result.current.error).toBeNull();
    expect(calls).toBe(3);
  });

  it("setData replaces the record in place", async () => {
    const { result } = renderHook(() => useApi("p", () => Promise.resolve({ n: 1 })));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    act(() => result.current.setData((prev) => ({ n: (prev?.n ?? 0) + 1 })));
    expect(result.current.data).toEqual({ n: 2 });
  });

  describe("the 30-second cache", () => {
    it("a cached list is served without a request on the next visit", async () => {
      const fetcher = vi.fn().mockResolvedValue(["a"]);
      const first = renderHook(() => useApi("/proposals", fetcher, { cache: true }));
      await waitFor(() => expect(first.result.current.data).toEqual(["a"]));
      first.unmount();
      const second = renderHook(() => useApi("/proposals", fetcher, { cache: true }));
      expect(second.result.current.data).toEqual(["a"]);
      expect(second.result.current.loading).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("expires after 30 seconds", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fetcher = vi.fn().mockResolvedValue(["a"]);
      const first = renderHook(() => useApi("/projects", fetcher, { cache: true }));
      await waitFor(() => expect(first.result.current.data).toEqual(["a"]));
      first.unmount();
      vi.setSystemTime(Date.now() + 31_000);
      renderHook(() => useApi("/projects", fetcher, { cache: true }));
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    });

    it("is keyed by the session: signing in never serves the signed-out answer", async () => {
      const fetcher = vi.fn().mockResolvedValueOnce("signed out").mockResolvedValueOnce("signed in");
      const first = renderHook(() => useApi("/feed", fetcher, { cache: true }));
      await waitFor(() => expect(first.result.current.data).toBe("signed out"));
      first.unmount();
      localStorage.setItem("civic_auth_token", "t1");
      const second = renderHook(() => useApi("/feed", fetcher, { cache: true }));
      await waitFor(() => expect(second.result.current.data).toBe("signed in"));
    });

    it("any write the app sends empties it", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
      const fetcher = vi.fn().mockResolvedValue(["a"]);
      const first = renderHook(() => useApi("/deliberations", fetcher, { cache: true }));
      await waitFor(() => expect(first.result.current.data).toEqual(["a"]));
      first.unmount();
      await request("POST", "/deliberations/drafts", {});
      renderHook(() => useApi("/deliberations", fetcher, { cache: true }));
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    });

    it("a read that does not opt in is never cached", async () => {
      const fetcher = vi.fn().mockResolvedValue({ has_voted: false });
      const first = renderHook(() => useApi("process/a", fetcher));
      await waitFor(() => expect(first.result.current.data).toBeDefined());
      first.unmount();
      renderHook(() => useApi("process/a", fetcher));
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    });
  });
});

describe("useApi rereadOn", () => {
  it("reads again when the reader changes, with the page still shown", async () => {
    let n = 0;
    const { result, rerender } = renderHook(({ actor }) => useApi("process/a/state", () => Promise.resolve(++n), { rereadOn: actor }), {
      initialProps: { actor: null as string | null },
    });
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ actor: "user_1" });
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.data).toBe(2));
  });
});
