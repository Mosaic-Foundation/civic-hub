import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { inviteLink, freshLink, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    body: Record<string, unknown>;
    constructor(message: string, body: Record<string, unknown>) {
      super(message);
      this.body = body;
    }
  }
  return { inviteLink: vi.fn(), freshLink: vi.fn(), ApiError };
});

vi.mock("./api", () => ({
  StartApiError: ApiError,
  startApi: { session: () => Promise.resolve({ step: "code", email: null, code_refused: false }), leave: vi.fn(), invite: vi.fn(), inviteLink, freshLink },
  startJurisdictions: {},
}));

function refused(link_state: string, extra: Record<string, unknown> = {}) {
  const error = `Refused: ${link_state}.`;
  return new ApiError(error, { error, link_state, email: null, hub_url: null, ...extra });
}

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

  it("follows an emailed invite's link once, out of the address; a used one offers a fresh link to the same address", async () => {
    inviteLink.mockReset().mockRejectedValue(refused("spent", { email: "sam@example.test" }));
    freshLink.mockReset().mockResolvedValue({ sent_to: "sam@example.test" });
    window.history.replaceState(null, "", "/#invite=tok_abc-1");
    const { default: App } = await import("./App");
    render(<App />);
    const button = await screen.findByRole("button", { name: "Send me a fresh link" });
    expect(inviteLink).toHaveBeenCalledTimes(1);
    expect(inviteLink).toHaveBeenCalledWith("tok_abc-1");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("heading").textContent).toBe("This link has been used");
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    button.click();
    expect((await screen.findByRole("status")).textContent).toMatch(/We sent a fresh link to sam@example.test/);
    expect(freshLink).toHaveBeenCalledWith("tok_abc-1");
  });

  it("an invite that made its hub links to the hub's sign-in, with no fresh link", async () => {
    inviteLink.mockReset().mockRejectedValue(refused("redeemed", { hub_url: "https://made.example.test/sign-in" }));
    window.history.replaceState(null, "", "/#invite=tok_abc-2");
    const { default: App } = await import("./App");
    render(<App />);
    const link = await screen.findByRole("link", { name: "Go to your hub's sign-in" });
    expect(link.getAttribute("href")).toBe("https://made.example.test/sign-in");
    expect(screen.queryByRole("button", { name: "Send me a fresh link" })).toBeNull();
  });

  it("an invite that ended says so, with no button", async () => {
    inviteLink.mockReset().mockRejectedValue(refused("ended"));
    window.history.replaceState(null, "", "/#invite=tok_abc-3");
    const { default: App } = await import("./App");
    render(<App />);
    expect((await screen.findByRole("heading")).textContent).toBe("This invite can't be used");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts empty without one", async () => {
    const field = await page();
    expect(field.value).toBe("");
  });
});
