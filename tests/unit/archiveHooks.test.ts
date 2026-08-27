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
