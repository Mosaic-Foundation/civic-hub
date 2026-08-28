import { describe, it, expect, vi } from "vitest";
import type {
  BriefContent,
  BriefProcessContext,
} from "../../src/modules/civic.brief/models.js";
import {
  RECIPIENT_LABEL_MAX,
  approveBrief,
  createBriefState,
  getPublicReadModel,
  normalizeRecipients,
  setRecipients,
} from "../../src/modules/civic.brief/service.js";

const ctx: BriefProcessContext = {
  process_id: "brief_1",
  hub_id: "hub",
  jurisdiction: "us-va-floyd",
  emit: vi.fn(async () => undefined),
};

function content(): BriefContent {
  return {
    title: "Water supply",
    headline: "Where the community landed",
    summary: "A clear consensus emerged.",
    sections: [],
    participation_label: null,
    participation_count: null,
    comments: [],
    admin_notes: "",
  };
}

function pendingState() {
  return createBriefState({
    source_process_id: "src_1",
    source_process_type: "civic.proposal",
    content: content(),
  });
}

const JANE = { email: "jane@floyd.gov", label: "Jane Doe, Board of Supervisors" };
const SAM = { email: "sam@floyd.gov", label: "Sam Lee, Town Council" };

// --- Validation -------------------------------------------------------------

describe("normalizeRecipients", () => {
  it("keeps valid rows, trims, and dedupes by email case-insensitively", () => {
    const out = normalizeRecipients([
      { email: "  jane@floyd.gov ", label: "  Jane Doe, Board of Supervisors " },
      { email: "JANE@floyd.gov", label: "Duplicate" },
      SAM,
    ]);
    expect(out).toEqual([JANE, SAM]);
  });

  it("silently drops fully blank rows (an empty add-row left behind)", () => {
    expect(normalizeRecipients([{ email: "", label: "" }, JANE])).toEqual([JANE]);
  });

  it("rejects a malformed email", () => {
    expect(() => normalizeRecipients([{ email: "not-an-email", label: "X" }]))
      .toThrow(/not a valid email/);
  });

  it("REFUSES a recipient without a label — the label is the only public half", () => {
    // Defaulting the label from the email would leak the address onto a
    // permanent public record; refusal here is what makes that impossible.
    expect(() => normalizeRecipients([{ email: "jane@floyd.gov", label: "" }]))
      .toThrow(/display label/);
  });

  it("caps label length", () => {
    expect(() =>
      normalizeRecipients([
        { email: "jane@floyd.gov", label: "x".repeat(RECIPIENT_LABEL_MAX + 1) },
      ]),
    ).toThrow(/characters or fewer/);
  });

  it("rejects non-array input", () => {
    expect(() => normalizeRecipients("jane@floyd.gov" as unknown as [])).toThrow(
      /list/,
    );
  });
});

// --- Pending-only edit ------------------------------------------------------

describe("setRecipients", () => {
  it("sets the selection while pending", () => {
    const state = pendingState();
    setRecipients(state, [JANE]);
    expect(state.recipients).toEqual([JANE]);
  });

  it("allows an explicit empty selection (publish with no delivery)", () => {
    const state = pendingState();
    setRecipients(state, []);
    expect(state.recipients).toEqual([]);
  });

  it("rejects changes once no longer pending — the delivery already happened", () => {
    const state = pendingState();
    state.publication_status = "published";
    expect(() => setRecipients(state, [JANE])).toThrow(/cannot be changed/);
  });
});

// --- Approval delivery resolution -------------------------------------------

describe("approveBrief — per-brief recipients", () => {
  const deps = () => ({
    fallbackRecipients: ["clerk@floyd.gov"],
    hubLabel: "Test Hub",
    publicBriefUrl: "https://hub/brief/brief_1",
    sendEmail: vi.fn(async () => undefined),
    finalizeSource: vi.fn(async () => undefined),
  });

  it("delivers to the admin's selection and records emails, labels, and send time", async () => {
    const state = pendingState();
    setRecipients(state, [JANE, SAM]);
    const d = deps();

    await approveBrief(state, "admin", ctx, d);

    expect(d.sendEmail).toHaveBeenCalledOnce();
    expect(d.sendEmail.mock.calls[0]![0].to).toEqual([JANE.email, SAM.email]);
    expect(state.delivered_to).toEqual([JANE.email, SAM.email]);
    expect(state.delivered_to_labels).toEqual([JANE.label, SAM.label]);
    expect(state.delivered_at).not.toBeNull();
  });

  it("an explicitly cleared selection publishes with NO email — the fallback does not resurrect delivery", async () => {
    const state = pendingState();
    setRecipients(state, []);
    const d = deps();

    await approveBrief(state, "admin", ctx, d);

    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(state.delivered_to).toEqual([]);
    expect(state.publication_status).toBe("published");
  });

  it("an untouched selection falls back to the hub-wide setting, recording no labels", async () => {
    const state = pendingState(); // recipients === undefined
    const d = deps();

    await approveBrief(state, "admin", ctx, d);

    expect(d.sendEmail).toHaveBeenCalledOnce();
    expect(state.delivered_to).toEqual(["clerk@floyd.gov"]);
    // No labels → the public page keeps the governing-body wording
    // instead of naming (or leaking) anything.
    expect(state.delivered_to_labels).toEqual([]);
  });
});

// --- Public receipt ---------------------------------------------------------

describe("getPublicReadModel — the Sent-to receipt", () => {
  it("exposes labels and send time, and NEVER the emails", async () => {
    const state = pendingState();
    setRecipients(state, [JANE]);
    await approveBrief(state, "admin", ctx, {
      fallbackRecipients: [],
      hubLabel: "H",
      publicBriefUrl: "u",
      sendEmail: vi.fn(async () => undefined),
      finalizeSource: vi.fn(async () => undefined),
    });

    const model = getPublicReadModel(state, {
      id: "brief_1",
      title: "Water supply",
      createdAt: "2026-08-28T00:00:00.000Z",
    })!;

    expect(model.sent_to).toEqual([JANE.label]);
    expect(model.delivered_at).toBe(state.delivered_at);
    expect(model).not.toHaveProperty("delivered_to");
    expect(JSON.stringify(model)).not.toContain(JANE.email);
  });

  it("legacy deliveries surface a count but empty sent_to", async () => {
    const state = pendingState(); // pre-picker brief
    await approveBrief(state, "admin", ctx, {
      fallbackRecipients: ["clerk@floyd.gov"],
      hubLabel: "H",
      publicBriefUrl: "u",
      sendEmail: vi.fn(async () => undefined),
      finalizeSource: vi.fn(async () => undefined),
    });

    const model = getPublicReadModel(state, {
      id: "brief_1",
      title: "Water supply",
      createdAt: "2026-08-28T00:00:00.000Z",
    })!;

    expect(model.delivered_recipient_count).toBe(1);
    expect(model.sent_to).toEqual([]);
    expect(JSON.stringify(model)).not.toContain("clerk@floyd.gov");
  });
});
