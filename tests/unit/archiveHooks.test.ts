import { describe, it, expect } from "vitest";
import { getAllHandlers } from "../../src/processes/registry.js";

/**
 * Archiving flips `processes.status`, which is enough ONLY for a process type
 * whose state lives entirely in that row. Three types do not:
 *
 *   - civic.proposal and civic.project each own a `status` column on their own
 *     table, and their read models read THAT copy
 *   - civic.wordcloud keeps `status` inside `state`, which its submission form
 *     reads
 *
 * Archiving without syncing those leaves a process hidden from the public list
 * while its detail page still renders it as live — or, for a word cloud, still
 * accepting submissions. These tests pin which handlers must carry the hooks,
 * so a refactor that drops one is caught here rather than by a resident
 * finding an archived thing still working.
 *
 * NOTE ON NAMING: "civic.proposal" here is the IDEA BOARD process type. It is
 * not a proposed vote (a civic.vote in `proposed` status gathering support).
 * Different things that share a word.
 */
describe("archive hooks — handlers that own storage must sync it", () => {
  const handlers = getAllHandlers();
  const byType = new Map(handlers.map((h) => [h.type, h]));

  const OWNS_ITS_OWN_STATUS = ["civic.proposal", "civic.project", "civic.wordcloud"];

  for (const type of OWNS_ITS_OWN_STATUS) {
    it(`${type} implements onArchive`, () => {
      expect(typeof byType.get(type)?.onArchive).toBe("function");
    });

    it(`${type} implements onRestore — archiving must be reversible`, () => {
      expect(typeof byType.get(type)?.onRestore).toBe("function");
    });
  }

  /**
   * The hooks are OPTIONAL by design. A type whose state lives only in the
   * processes row needs neither, and requiring them would be ceremony. This
   * pins that the seam stays opt-in rather than becoming mandatory.
   */
  it("leaves the hooks optional for types that need neither", () => {
    const vote = byType.get("civic.vote");
    expect(vote).toBeDefined();
    expect(vote?.onArchive).toBeUndefined();
    expect(vote?.onRestore).toBeUndefined();
  });

  /**
   * A handler that syncs on the way in but not on the way out would make
   * archiving a one-way door for that type.
   */
  it("no handler implements one hook without the other", () => {
    for (const h of handlers) {
      const hasArchive = typeof h.onArchive === "function";
      const hasRestore = typeof h.onRestore === "function";
      expect(
        hasArchive === hasRestore,
        `${h.type} implements only one of onArchive/onRestore`,
      ).toBe(true);
    }
  });
});

/**
 * UNIVERSALITY GUARD FOR NEW PLUGINS.
 *
 * Archiving works for a new process type with no work at all — `archiveProcess`
 * flips `processes.status`, which is what the public list, direct fetch, feed,
 * digest and Outcomes all read. Verified on dev across every registered type,
 * including civic.brief, which implements neither hook.
 *
 * The one way to get it wrong is to add a type that keeps state OUTSIDE the
 * processes row — a child table with its own status column, or a status inside
 * `state` — and not implement the hooks. Then the thing archives on the generic
 * surfaces while its own page still serves it. That is exactly the bug found in
 * civic.proposal on 2026-08-26.
 *
 * Nothing can detect that automatically without a database. So this test pins
 * the registry instead: adding a process type FAILS here until someone adds it
 * to the list below, and the failure message tells them what to decide. It is
 * a speed bump on purpose.
 */
describe("registry snapshot — adding a process type forces an archive decision", () => {
  const KNOWN_TYPES = [
    "civic.announcement",
    "civic.brief",
    "civic.meeting_summary",
    "civic.polis_deliberation",
    "civic.project",
    "civic.proposal",
    "civic.vote",
    "civic.vote_results",
    "civic.wordcloud",
  ];

  it("has no process type this test has not been told about", () => {
    const registered = getAllHandlers().map((h) => h.type).sort();
    const unknown = registered.filter((t) => !KNOWN_TYPES.includes(t));
    expect(
      unknown,
      unknown.length
        ? `New process type(s): ${unknown.join(", ")}.\n` +
          "Before adding them to KNOWN_TYPES, decide: does this type keep any " +
          "state OUTSIDE its `processes` row — a child table with its own " +
          "status, or a status inside `state`? If so it MUST implement " +
          "onArchive/onRestore, or archiving will hide it from the feed while " +
          "its own page keeps serving it. If all its state lives in the " +
          "processes row, it needs neither and archiving already works."
        : undefined,
    ).toEqual([]);
  });

  it("still knows about every type in the list", () => {
    const registered = getAllHandlers().map((h) => h.type);
    for (const t of KNOWN_TYPES) expect(registered).toContain(t);
  });
});
