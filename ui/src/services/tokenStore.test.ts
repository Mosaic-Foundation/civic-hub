import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, getStoredToken, storeToken } from "./tokenStore";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("tokenStore", () => {
  it("keeps the token", () => {
    expect(getStoredToken()).toBeNull();
    storeToken("t1");
    expect(getStoredToken()).toBe("t1");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });

  it("blocked storage reads as signed out and never throws", () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked, clear: () => {} });
    expect(getStoredToken()).toBeNull();
    expect(() => storeToken("t1")).not.toThrow();
    expect(() => clearToken()).not.toThrow();
  });
});
