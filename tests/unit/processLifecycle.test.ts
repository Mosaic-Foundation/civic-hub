import { describe, it, expect } from "vitest";
import type { ProcessStatus } from "../../src/models/process.js";
import {
  resolveInitialStatus,
  isPubliclyFetchable,
  isActionable,
  shouldEmitStatusUpdate,
  nonPublicStatusFilter,
  NON_PUBLIC_STATUSES,
} from "../../src/services/processLifecycle.js";
import { rowToProcess, type ProcessRow } from "../../src/services/processService.js";

const ALL_STATUSES: ProcessStatus[] = [
  "draft",
  "proposed",
  "threshold_met",
  "active",
  "closed",
  "finalized",
  "pending_review",
  "archived",
];

describe("processLifecycle — pure lifecycle decisions", () => {
  describe("resolveInitialStatus", () => {
    it("defaults to active when the handler declares no resting status", () => {
      expect(resolveInitialStatus(undefined)).toBe("active");
    });
    it("preserves a handler-declared resting status", () => {
      for (const s of ALL_STATUSES) {
        expect(resolveInitialStatus(s)).toBe(s);
      }
    });
  });

  describe("isPubliclyFetchable", () => {
    it("hides pending_review and archived", () => {
      expect(isPubliclyFetchable("pending_review")).toBe(false);
      expect(isPubliclyFetchable("archived")).toBe(false);
    });
    it("exposes every other status (incl. draft/proposed/closed/finalized)", () => {
      for (const s of ALL_STATUSES) {
        const expected = s !== "pending_review" && s !== "archived";
        expect(isPubliclyFetchable(s)).toBe(expected);
      }
    });
  });

  describe("isActionable", () => {
    it("rejects only finalized", () => {
      for (const s of ALL_STATUSES) {
        expect(isActionable(s)).toBe(s !== "finalized");
      }
    });
  });

  describe("shouldEmitStatusUpdate", () => {
    it("emits only when the status actually changed", () => {
      expect(shouldEmitStatusUpdate("active", "closed")).toBe(true);
      expect(shouldEmitStatusUpdate("proposed", "active")).toBe(true);
      expect(shouldEmitStatusUpdate("active", "active")).toBe(false);
      expect(shouldEmitStatusUpdate("closed", "closed")).toBe(false);
    });
  });

  describe("nonPublicStatusFilter ↔ NON_PUBLIC_STATUSES", () => {
    it("is the PostgREST in-list literal for the non-public statuses", () => {
      expect(nonPublicStatusFilter()).toBe('("pending_review","archived")');
    });
    it("stays in lockstep with the predicate (no drift between query and gate)", () => {
      // Every status the filter excludes must be the set the gate hides.
      for (const s of ALL_STATUSES) {
        const excludedByFilter = NON_PUBLIC_STATUSES.includes(s);
        expect(excludedByFilter).toBe(!isPubliclyFetchable(s));
      }
    });
  });
});

describe("rowToProcess — row → model mapping + defaults", () => {
  function row(overrides: Partial<ProcessRow> = {}): ProcessRow {
    return {
      id: "proc_1",
      type: "civic.vote",
      process_version: "1.0",
      title: "Park funding",
      description: "Should we fund the park?",
      jurisdiction: "floyd-va",
      status: "active",
      content: null,
      state: { foo: "bar" },
      hub_id: "floyd",
      created_by: "user_1",
      source_proposal_id: null,
      starts_at: null,
      ends_at: null,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-02T00:00:00Z",
      ...overrides,
    };
  }

  it("maps the core fields", () => {
    const p = rowToProcess(row());
    expect(p).toMatchObject({
      id: "proc_1",
      title: "Park funding",
      description: "Should we fund the park?",
      status: "active",
      hubId: "floyd",
      jurisdiction: "floyd-va",
      createdBy: "user_1",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
    });
    expect(p.definition).toEqual({ type: "civic.vote", version: "1.0" });
    expect(p.state).toEqual({ foo: "bar" });
  });

  it("applies defaults for null columns", () => {
    const p = rowToProcess(
      row({
        description: null,
        jurisdiction: null,
        created_by: null,
        state: null as unknown as ProcessRow["state"],
      }),
    );
    expect(p.description).toBe("");
    expect(p.jurisdiction).toBe("local");
    // hub_id is NOT NULL since Phase 2 and is the tenant, never defaulted
    // to the protocol id.
    expect(p.hubId).toBe("floyd");
    expect(p.createdBy).toBe("");
    expect(p.state).toEqual({});
  });

  it("attaches content only when present", () => {
    expect(rowToProcess(row({ content: null })).content).toBeUndefined();
    const withContent = rowToProcess(
      row({ content: { kind: "x" } as unknown as ProcessRow["content"] }),
    );
    expect(withContent.content).toEqual({ kind: "x" });
  });
});
