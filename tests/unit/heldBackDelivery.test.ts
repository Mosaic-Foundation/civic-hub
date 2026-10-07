// Held back is not failed (2026-10-07, review #34).
//
// On a demo or beta hub the mail guard holds mail to anyone off the admin
// roster and allow list. Approving a brief used to answer 500 "Email delivery
// failed: … suppressed by hub mode" and leave it pending. Now the brief
// publishes, its record names who was held back and why, the public receipt
// names only who was really sent it, and the admin reads it in plain words.

import { describe, it, expect, vi } from "vitest";
import type { BriefContent, BriefProcessContext } from "../../src/modules/civic.brief/models.js";
import { approveBrief, createBriefState, getPublicReadModel } from "../../src/modules/civic.brief/service.js";
import { publishedMessage } from "../../src/shared/delivery.js";

const ctx: BriefProcessContext = {
  process_id: "brief_1",
  hub_id: "hub",
  jurisdiction: "us-test",
  emit: vi.fn(async () => undefined),
};

function pendingState() {
  const content: BriefContent = {
    title: "Water supply",
    headline: "Where the community landed",
    summary: "A clear consensus emerged.",
    sections: [],
    participation_label: null,
    participation_count: null,
    comments: [],
    admin_notes: "",
  };
  return createBriefState({ source_process_id: "src_1", source_process_type: "civic.vote", content });
}

const CLERK = { email: "clerk@hub.example", label: "Hub Clerk" };
const BOARD = { email: "chair@county.example", label: "Board of Supervisors" };

describe("approveBrief with recipients held back", () => {
  it("publishes, records who was held back and why, and the receipt names only who was sent it", async () => {
    const state = pendingState();
    state.recipients = [CLERK, BOARD];
    const finalizeSource = vi.fn(async () => undefined);
    await approveBrief(state, "admin", ctx, {
      fallbackRecipients: [],
      hubLabel: "Test Hub",
      publicBriefUrl: "https://hub.example/brief/brief_1",
      sendEmail: async () => ({
        sent: [CLERK.email],
        held_back: [{ email: BOARD.email, reason: "this hub is in demo mode" }],
      }),
      finalizeSource,
    });
    expect(state.publication_status).toBe("published");
    expect(finalizeSource).toHaveBeenCalled();
    expect(state.delivered_to).toEqual([CLERK.email]);
    expect(state.delivered_to_labels).toEqual(["Hub Clerk"]);
    expect(state.held_back).toEqual([{ email: BOARD.email, reason: "this hub is in demo mode" }]);
    expect(state.held_back_labels).toEqual(["Board of Supervisors"]);
    const pub = getPublicReadModel(state, { id: "brief_1", title: "Water", createdAt: "2026-10-07" })!;
    expect(pub.sent_to).toEqual(["Hub Clerk"]);
    expect(JSON.stringify(pub)).not.toContain("held_back");
  });

  it("with everyone held back: published, no send time, no receipt", async () => {
    const state = pendingState();
    state.recipients = [BOARD];
    await approveBrief(state, "admin", ctx, {
      fallbackRecipients: [],
      hubLabel: "Test Hub",
      publicBriefUrl: "https://hub.example/brief/brief_1",
      sendEmail: async () => ({ sent: [], held_back: [{ email: BOARD.email, reason: "this hub is in beta mode" }] }),
      finalizeSource: async () => undefined,
    });
    expect(state.publication_status).toBe("published");
    expect(state.delivered_to).toEqual([]);
    expect(state.delivered_at).toBeNull();
    expect(state.delivered_to_labels).toEqual([]);
  });

  it("a real failure still halts before publishing", async () => {
    const state = pendingState();
    state.recipients = [BOARD];
    await expect(
      approveBrief(state, "admin", ctx, {
        fallbackRecipients: [],
        hubLabel: "Test Hub",
        publicBriefUrl: "x",
        sendEmail: async () => {
          throw new Error("Email delivery failed: chair@county.example: Resend 500");
        },
        finalizeSource: async () => undefined,
      }),
    ).rejects.toThrow("Resend 500");
    expect(state.publication_status).toBe("approved");
  });
});

describe("publishedMessage — what the admin reads", () => {
  it("everyone held back", () => {
    expect(publishedMessage([], { names: ["Board of Supervisors"], reasons: ["this hub is in demo mode"] })).toBe(
      "Published. Not emailed to Board of Supervisors because this hub is in demo mode.",
    );
  });

  it("some sent, some held back", () => {
    expect(
      publishedMessage(["Hub Clerk"], {
        names: ["Board of Supervisors", "Planning Commission"],
        reasons: ["this hub is in beta mode", "this hub is in beta mode"],
      }),
    ).toBe(
      "Published. Emailed to Hub Clerk. Not emailed to Board of Supervisors and Planning Commission because this hub is in beta mode.",
    );
  });

  it("all sent, or no recipients", () => {
    expect(publishedMessage(["A", "B", "C"], { names: [], reasons: [] })).toBe("Published. Emailed to A, B and C.");
    expect(publishedMessage([], { names: [], reasons: [] })).toBe("Published.");
  });

  it("sample content", () => {
    expect(publishedMessage([], { names: ["x@example.test"], reasons: ["this is sample content"] })).toBe(
      "Published. Not emailed to x@example.test because this is sample content.",
    );
  });
});
