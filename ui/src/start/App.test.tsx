import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { inviteLink } = vi.hoisted(() => ({ inviteLink: vi.fn() }));

vi.mock("./api", () => ({
  StartApiError: class extends Error {},
  startApi: { session: () => Promise.resolve({ step: "code", email: null, code_refused: false }), leave: vi.fn(), invite: vi.fn(), inviteLink },
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

  it("follows an emailed invite's link once, out of the address, and shows a refusal", async () => {
    inviteLink.mockReset().mockRejectedValue(new Error("That link has been used or has expired."));
    window.history.replaceState(null, "", "/#invite=tok_abc-1");
    const field = await page();
    expect(inviteLink).toHaveBeenCalledTimes(1);
    expect(inviteLink).toHaveBeenCalledWith("tok_abc-1");
    expect(window.location.hash).toBe("");
    expect(field.value).toBe("");
    expect(screen.getByRole("status").textContent).toMatch(/used or has expired/);
  });

  it("starts empty without one", async () => {
    const field = await page();
    expect(field.value).toBe("");
  });
});
