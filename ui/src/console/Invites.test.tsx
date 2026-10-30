import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Invites from "./Invites";

const mintInvite = vi.fn();
const sendInvite = vi.fn();

vi.mock("./api", () => ({
  api: {
    invites: () => Promise.resolve({ invites: [], start_hostname: "start.example.test", default_days: 14, max_days: 90 }),
    mintInvite: (...a: unknown[]) => mintInvite(...a),
    sendInvite: (...a: unknown[]) => sendInvite(...a),
    revokeInvite: vi.fn(),
  },
}));

beforeEach(() => {
  mintInvite.mockReset().mockResolvedValue({ code: "AB12-CD34-EF56", invite: { id: "ent_1" }, start_hostname: "start.example.test" });
  sendInvite.mockReset().mockResolvedValue({ sent_to: "sam@example.test" });
});

describe("issuing an invite", () => {
  it("asks for the address on the first form, and sends as it mints", async () => {
    const user = userEvent.setup();
    render(<Invites />);
    await user.type(await screen.findByLabelText(/^Email it to/), "sam@example.test");
    await user.click(screen.getByRole("button", { name: "Mint and send" }));
    expect(sendInvite).toHaveBeenCalledWith("ent_1", "AB12-CD34-EF56", "sam@example.test");
    expect(await screen.findByText("Sent to sam@example.test.")).toBeTruthy();
    expect(screen.getByText("AB12-CD34-EF56")).toBeTruthy();
  });

  it("mints without sending when no address is given", async () => {
    const user = userEvent.setup();
    render(<Invites />);
    await user.click(await screen.findByRole("button", { name: "Mint a code" }));
    expect(await screen.findByText("AB12-CD34-EF56")).toBeTruthy();
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("keeps the code on the card when the send fails, and says why", async () => {
    sendInvite.mockRejectedValue(new Error("The email could not be sent."));
    const user = userEvent.setup();
    render(<Invites />);
    await user.type(await screen.findByLabelText(/^Email it to/), "sam@example.test");
    await user.click(screen.getByRole("button", { name: "Mint and send" }));
    expect(await screen.findByText("The email could not be sent.")).toBeTruthy();
    expect(screen.getByText("AB12-CD34-EF56")).toBeTruthy();
  });
});
