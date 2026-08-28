import { describe, it, expect, vi } from "vitest";
import type {
  BriefContent,
  BriefProcessState,
  BriefPublicationStatus,
} from "../../src/modules/civic.brief/models.js";
import {
  canEdit,
  canApprove,
  isPublished,
  assertPublicationTransition,
} from "../../src/modules/civic.brief/lifecycle.js";
import {
  createBriefState,
  editBrief,
  approveBrief,
  getPublicReadModel,
} from "../../src/modules/civic.brief/service.js";

const ALL: BriefPublicationStatus[] = ["pending", "approved", "published"];

function st(status: BriefPublicationStatus): BriefProcessState {
  return { publication_status: status } as BriefProcessState;
}

function sampleContent(over: Partial<BriefContent> = {}): BriefContent {
  return {
    title: "Water supply",
    headline: "Where the community landed",
    summary: "A clear consensus emerged.",
    sections: [{ heading: "Agreement", body: "• Conserve water (80%)" }],
    participation_label: "42 participants",
    participation_count: 42,
    comments: ["Great discussion"],
    admin_notes: "",
    ...over,
  };
}

const ctx = {
  process_id: "brief_1",
  hub_id: "hub",
  jurisdiction: "local",
  emit: vi.fn(async () => undefined),
};

describe("civic.brief — lifecycle state machine", () => {
  it("canEdit / canApprove only while pending", () => {
    for (const s of ALL) {
      expect(canEdit(st(s))).toBe(s === "pending");
      expect(canApprove(st(s))).toBe(s === "pending");
    }
  });

  it("isPublished only when published", () => {
    for (const s of ALL) expect(isPublished(st(s))).toBe(s === "published");
  });

  it("allows pending → approved → published, rejects skips/reversals", () => {
    expect(() => assertPublicationTransition("pending", "approved")).not.toThrow();
    expect(() => assertPublicationTransition("approved", "published")).not.toThrow();
    expect(() => assertPublicationTransition("pending", "published")).toThrow();
    expect(() => assertPublicationTransition("approved", "pending")).toThrow();
    expect(() => assertPublicationTransition("published", "approved")).toThrow();
  });
});

describe("civic.brief — createBriefState", () => {
  it("wraps handler content into a pending brief", () => {
    const state = createBriefState({
      source_process_id: "conv_1",
      source_process_type: "civic.polis_deliberation",
      content: sampleContent(),
    });
    expect(state.type).toBe("civic.brief");
    expect(state.publication_status).toBe("pending");
    expect(state.source_process_id).toBe("conv_1");
    expect(state.source_process_type).toBe("civic.polis_deliberation");
    expect(state.approved_at).toBeNull();
    expect(state.published_at).toBeNull();
    expect(state.delivered_to).toEqual([]);
    expect(state.content.headline).toBe("Where the community landed");
  });

  it("normalizes malformed content (drops empty sections, dedups comments)", () => {
    const state = createBriefState({
      source_process_id: "p",
      source_process_type: "civic.proposal",
      content: sampleContent({
        sections: [
          { heading: "", body: "" },
          { heading: "Real", body: "x" },
        ],
        comments: ["a", "a", "  ", "b"],
      }),
    });
    expect(state.content.sections).toHaveLength(1);
    expect(state.content.comments).toEqual(["a", "b"]);
  });
});

describe("civic.brief — editBrief", () => {
  it("edits headline/summary/comments while pending", async () => {
    const state = createBriefState({
      source_process_id: "c",
      source_process_type: "civic.polis_deliberation",
      content: sampleContent(),
    });
    await editBrief(state, "admin", { headline: "New headline", comments: ["x"] }, ctx);
    expect(state.content.headline).toBe("New headline");
    expect(state.content.comments).toEqual(["x"]);
  });

  it("rejects edits once approved/published", async () => {
    const state = createBriefState({
      source_process_id: "c",
      source_process_type: "civic.polis_deliberation",
      content: sampleContent(),
    });
    state.publication_status = "published";
    await expect(editBrief(state, "admin", { headline: "no" }, ctx)).rejects.toThrow();
  });
});

describe("civic.brief — approveBrief orchestration", () => {
  it("delivers, publishes, and finalizes the source when recipients are set", async () => {
    const state = createBriefState({
      source_process_id: "conv_1",
      source_process_type: "civic.polis_deliberation",
      content: sampleContent(),
    });
    const sendEmail = vi.fn(async () => undefined);
    const finalizeSource = vi.fn(async () => undefined);

    await approveBrief(state, "admin", ctx, {
      fallbackRecipients: ["board@example.com"],
      hubLabel: "Test Hub",
      publicBriefUrl: "https://hub/brief/brief_1",
      sendEmail,
      finalizeSource,
    });

    expect(state.publication_status).toBe("published");
    expect(state.approved_at).not.toBeNull();
    expect(state.published_at).not.toBeNull();
    expect(state.delivered_to).toEqual(["board@example.com"]);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(finalizeSource).toHaveBeenCalledWith(
      "conv_1",
      "civic.polis_deliberation",
      "admin",
    );
  });

  it("publishes without an email when no recipients are configured", async () => {
    const state = createBriefState({
      source_process_id: "proj_1",
      source_process_type: "civic.project",
      content: sampleContent(),
    });
    const sendEmail = vi.fn(async () => undefined);
    const finalizeSource = vi.fn(async () => undefined);

    await approveBrief(state, "admin", ctx, {
      fallbackRecipients: [],
      hubLabel: "Test Hub",
      publicBriefUrl: "https://hub/brief/proj_1",
      sendEmail,
      finalizeSource,
    });

    expect(state.publication_status).toBe("published");
    expect(state.delivered_to).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(finalizeSource).toHaveBeenCalledOnce();
  });

  it("rejects a double approve", async () => {
    const state = createBriefState({
      source_process_id: "c",
      source_process_type: "civic.vote",
      content: sampleContent(),
    });
    state.publication_status = "published";
    await expect(
      approveBrief(state, "admin", ctx, {
        fallbackRecipients: [],
        hubLabel: "H",
        publicBriefUrl: "u",
        sendEmail: vi.fn(async () => undefined),
        finalizeSource: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow();
  });
});

describe("civic.brief — getPublicReadModel", () => {
  it("returns null unless published", () => {
    const state = createBriefState({
      source_process_id: "c",
      source_process_type: "civic.vote",
      content: sampleContent(),
    });
    expect(getPublicReadModel(state, { id: "b", title: "t", createdAt: "d" })).toBeNull();
    state.publication_status = "published";
    const model = getPublicReadModel(state, { id: "b", title: "t", createdAt: "d" });
    expect(model).not.toBeNull();
    // Never leaks the recipient emails — only a count.
    expect(model).not.toHaveProperty("delivered_to");
    expect(model).toHaveProperty("delivered_recipient_count");
  });
});
