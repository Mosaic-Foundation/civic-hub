import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./api", () => ({
  StartApiError: class extends Error {},
  startApi: { session: () => Promise.resolve({ step: "code", email: null, code_refused: false }), leave: vi.fn(), invite: vi.fn() },
  startJurisdictions: {},
}));

afterEach(() => {
  vi.resetModules();
  window.history.replaceState(null, "", "/");
});

async function page() {
  const { default: App } = await import("./App");
  render(<App />);
  return (await screen.findByLabelText("Invite code")) as HTMLInputElement;
}

describe("the start page's code step", () => {
  it("fills the field from an invite link and takes the code out of the address", async () => {
    window.history.replaceState(null, "", "/#code=ab12-cd34-ef56");
    const field = await page();
    expect(field.value).toBe("AB12-CD34-EF56");
    expect(window.location.hash).toBe("");
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts empty without one", async () => {
    const field = await page();
    expect(field.value).toBe("");
  });
});
