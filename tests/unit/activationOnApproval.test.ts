// Approval activation is registry-driven: a process type declares what
// approval does to it (the status it lands on, the lifecycle action that
// makes it real, and what a failure means), and the shared review service
// enforces that uniformly with no per-type branches of its own.
//
// These tests pin the seam. The drift guard at the bottom is the important
// one: it fails if anyone reintroduces a `proc.type === "civic.<x>"` branch
// into the activation path of approveReview — which is exactly how votes and
// conversations ended up with two different, undeclared failure policies.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  activationOnApproval,
  getRegisteredTypes,
  getProcessHandler,
} from "../../src/processes/registry.js";
import type { Process } from "../../src/models/process.js";

function processOf(type: string, state: Record<string, unknown> = {}): Process {
  return {
    id: "proc_test",
    definition: { type, version: "0.1" },
    title: "Test",
    description: "",
    status: "pending_review",
    hubId: "civic-hub-test",
    jurisdiction: "local",
    createdBy: "user_test",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    state,
  };
}

describe("activationOnApproval — the default", () => {
  it("publishes an undeclared type straight to active, with no action to fail", () => {
    expect(activationOnApproval(processOf("civic.project"))).toEqual({
      status: "active",
    });
  });

  it("gives a type this hub has never registered the same safe default", () => {
    // A type from a future plugin must not fall through to "approved but
    // nothing happened" just because nobody edited the review service.
    expect(activationOnApproval(processOf("civic.something.new"))).toEqual({
      status: "active",
    });
  });

  it("never leaves a registered type without a resolvable activation", () => {
    for (const type of getRegisteredTypes()) {
      const activation = activationOnApproval(processOf(type));
      expect(activation.status, `${type} status`).toBeTruthy();
      if (activation.action) {
        expect(["required", "best_effort"]).toContain(
          activation.action.onFailure,
        );
        expect(activation.action.type, `${type} action type`).toBeTruthy();
      }
    }
  });
});

describe("activationOnApproval — declared policies", () => {
  it("sends a vote to its community-support phase, and treats failure as fatal", () => {
    expect(activationOnApproval(processOf("civic.vote"))).toEqual({
      status: "proposed",
      action: { type: "process.propose", onFailure: "required" },
    });
  });

  it("opens a direct-activation vote straight away", () => {
    const direct = processOf("civic.vote", {
      config: { activation_mode: "direct" },
    });
    expect(activationOnApproval(direct)).toEqual({
      status: "active",
      action: { type: "process.activate", onFailure: "required" },
    });
  });

  it("starts a conversation best-effort, so Polis cannot undo an approval", () => {
    expect(activationOnApproval(processOf("civic.polis_deliberation"))).toEqual({
      status: "draft",
      action: { type: "start", onFailure: "best_effort" },
    });
  });
});

describe("the review service holds no per-type activation branches", () => {
  const source = readFileSync(
    new URL("../../src/modules/civic.review/service.ts", import.meta.url),
    "utf8",
  );

  it("asks the registry for the activation rather than reading proc.type", () => {
    expect(source).toContain("activationOnApproval(rowToProcess(proc))");
  });

  it("dispatches both failure policies without naming a process type", () => {
    for (const policy of ['"required"', '"best_effort"']) {
      const guard = `activation.action?.onFailure === ${policy}`;
      expect(source, `missing ${policy} dispatch`).toContain(guard);
    }
    // The activation branches must gate on the declared policy, never on the
    // type. `civic.project` is still allowed to appear elsewhere in the file —
    // creating a child table row on approval is a different concern.
    for (const type of ["civic.vote", "civic.polis_deliberation"]) {
      expect(
        source.includes(`proc.type === "${type}"`),
        `approval still branches on ${type}`,
      ).toBe(false);
    }
  });

  it("alerts admins when a best-effort activation fails", () => {
    expect(source).toContain("notifyAdminActivationFailed");
    expect(source).toContain("getAdminEmails()");
  });
});

describe("handlers own their policy, not the service", () => {
  it("declares vote and conversation policy on the handlers themselves", () => {
    expect(
      getProcessHandler("civic.vote")?.activationOnApproval,
    ).toBeTypeOf("function");
    expect(
      getProcessHandler("civic.polis_deliberation")?.activationOnApproval,
    ).toBeTypeOf("function");
  });
});
