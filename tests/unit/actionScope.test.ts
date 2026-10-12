// The action scope (Audit 3): inside an action, events about the acting
// process are held for its write, events about other processes are not, and
// after-commit work waits for the write. Outside an action nothing is held.

import { describe, expect, it } from "vitest";
import { afterActionCommits, holdForAction, runInActionScope } from "../../src/services/actionScope.js";
import type { CivicEvent } from "../../src/models/event.js";

const ev = (process_id: string, id = `evt_${process_id}`) => ({ id, process_id } as unknown as CivicEvent);

describe("actionScope", () => {
  it("holds events about the acting process, in order, and passes others through", async () => {
    const passed: string[] = [];
    const { events } = await runInActionScope("proc_a", async () => {
      for (const e of [ev("proc_a", "e1"), ev("proc_b", "e2"), ev("proc_a", "e3")]) {
        if (!holdForAction(e)) passed.push(e.id);
      }
    });
    expect(events.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(passed).toEqual(["e2"]);
  });

  it("holds nothing outside an action", () => {
    expect(holdForAction(ev("proc_a"))).toBe(false);
  });

  it("queues after-commit work inside an action and runs it at once outside", async () => {
    const ran: string[] = [];
    const { afterCommit } = await runInActionScope("proc_a", async () => {
      await afterActionCommits(async () => {
        ran.push("queued");
      });
    });
    expect(ran).toEqual([]);
    for (const fn of afterCommit) await fn();
    expect(ran).toEqual(["queued"]);

    await afterActionCommits(async () => {
      ran.push("now");
    });
    expect(ran).toEqual(["queued", "now"]);
  });

  it("keeps two concurrent actions' events apart", async () => {
    const [a, b] = await Promise.all([
      runInActionScope("proc_a", async () => {
        await new Promise((r) => setTimeout(r, 5));
        holdForAction(ev("proc_a", "a1"));
      }),
      runInActionScope("proc_b", async () => {
        holdForAction(ev("proc_b", "b1"));
        await new Promise((r) => setTimeout(r, 1));
        holdForAction(ev("proc_a", "stray"));
      }),
    ]);
    expect(a.events.map((e) => e.id)).toEqual(["a1"]);
    expect(b.events.map((e) => e.id)).toEqual(["b1"]);
  });
});
