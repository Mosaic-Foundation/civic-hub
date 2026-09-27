// Sample content (Phase 7): which rows it is made of, the templates' rules,
// and the governing body the console infers.
//
// Pure — the classification lists, the templates file and the inference are
// data and functions. The database half (the triggers, the delete guard,
// removal, /events) is tests/api/sampleContent.test.ts.

import { describe, it, expect } from "vitest";
import { EXPORT_MANIFEST } from "../../src/db/schemaContract.js";
import {
  MARKED_TABLES,
  NOT_PROCESS_CONTENT,
  PARTICIPATION_TABLES,
  PROCESS_CHILD_COLUMNS,
  isSampleRow,
  sampleProcessId,
  sampleUserId,
} from "../../src/models/sampleContent.js";
import { isSampleContentRow } from "../../src/control/hubBundle/format.js";
import {
  SAMPLE_AUTHORS,
  SAMPLE_TEMPLATES,
  fillSample,
  templatesFor,
  type SampleTemplate,
} from "../../src/services/sampleTemplates.js";
import { defaultGoverningBody, isJurisdictionType, JURISDICTION_TYPES } from "../../src/shared/jurisdictionType.js";

describe("which rows are sample content", () => {
  it("classifies every table that carries hub_id, on purpose", () => {
    // A table added later must be put in one list or the other: in
    // PROCESS_CHILD_COLUMNS its rows leave with removal and stay out of the
    // export; in NOT_PROCESS_CONTENT, with a reason, they never do.
    const classified = new Set([
      ...MARKED_TABLES,
      ...Object.keys(PROCESS_CHILD_COLUMNS),
      ...Object.keys(NOT_PROCESS_CONTENT),
    ]);
    const unclassified = EXPORT_MANIFEST.map((e) => e.table).filter((t) => !classified.has(t));
    expect(unclassified, "tables in neither PROCESS_CHILD_COLUMNS nor NOT_PROCESS_CONTENT").toEqual([]);
    const both = Object.keys(PROCESS_CHILD_COLUMNS).filter((t) => t in NOT_PROCESS_CONTENT);
    expect(both).toEqual([]);
  });

  it("counts real input only in tables it would delete", () => {
    for (const t of PARTICIPATION_TABLES) {
      expect(PROCESS_CHILD_COLUMNS[t.table], t.table).toContain(t.processColumn);
    }
  });

  const ids = { processIds: new Set(["proc_s"]), userIds: new Set(["user_s"]) };

  it("reads the marker on the marked tables", () => {
    expect(isSampleRow("processes", { id: "proc_s", is_sample: true }, ids)).toBe(true);
    expect(isSampleRow("processes", { id: "proc_real", is_sample: false }, ids)).toBe(false);
    expect(isSampleRow("events", { id: "e1", process_id: "proc_real", is_sample: true }, ids)).toBe(true);
    expect(isSampleRow("users", { id: "user_s", is_sample: false }, ids)).toBe(true);
    expect(isSampleRow("users", { id: "user_real", is_sample: false }, ids)).toBe(false);
  });

  it("finds child rows through their sample process, any listed column", () => {
    expect(isSampleRow("vote_records", { process_id: "proc_s" }, ids)).toBe(true);
    expect(isSampleRow("vote_records", { process_id: "proc_real" }, ids)).toBe(false);
    expect(isSampleRow("process_links", { from_id: "proc_real", to_id: "proc_s" }, ids)).toBe(true);
    expect(isSampleRow("proposals", { id: "proc_s" }, ids)).toBe(true);
    expect(isSampleRow("community_inputs", { process_id: "proc_s", author_id: "user_real" }, ids)).toBe(true);
    expect(isSampleRow("hub_settings", { key: "identity.name" }, ids)).toBe(false);
    expect(isSampleRow("events", { id: "e2", process_id: null, is_sample: false }, ids)).toBe(false);
  });

  it("is what the export's hook asks", () => {
    expect(isSampleContentRow("vote_records", { process_id: "proc_s" }, ids)).toBe(true);
    expect(isSampleContentRow("vote_records", { process_id: "proc_real" }, ids)).toBe(false);
  });

  it("gives each hub its own sample ids", () => {
    expect(sampleUserId("athens", 1)).toBe("user_sample_athens_001");
    expect(sampleUserId("athens", 1)).not.toBe(sampleUserId("utopia", 1));
    expect(sampleProcessId("athens", "vote_internet")).toBe("proc_sample_athens_vote_internet");
  });
});

describe("the sample templates", () => {
  const texts = (t: SampleTemplate): string[] => {
    switch (t.kind) {
      case "vote":
        return [t.title, t.description, ...t.options];
      case "outcome":
        return [t.headline, t.summary, t.participation_label, t.sent_to, ...t.sections.flatMap((s) => [s.heading, s.body])];
      case "proposal":
        return [t.title, t.description, ...t.comments.map((c) => c.body)];
      case "deliberation":
        return [t.topic, t.framing, ...t.statements];
      case "project":
        return [t.title, t.description, ...t.updates.map((u) => u.body), ...t.comments.map((c) => c.body)];
      case "announcement":
        return [t.title, t.body];
    }
  };

  it("uses only the three placeholders", () => {
    for (const t of SAMPLE_TEMPLATES) {
      for (const text of texts(t)) {
        const placeholders = [...text.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]);
        for (const p of placeholders) expect(["HUB_NAME", "JURISDICTION", "GOVERNING_BODY"], `${t.key}: {${p}}`).toContain(p);
      }
    }
  });

  it("has unique keys, known authors, and 8 to 10 processes for a general-purpose government", () => {
    const keys = SAMPLE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of SAMPLE_TEMPLATES) expect(Object.keys(SAMPLE_AUTHORS)).toContain(t.by);
    const n = templatesFor("county").length;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(10);
  });

  it("gives every vote options on more than one side, and ballots for each", () => {
    for (const t of SAMPLE_TEMPLATES) {
      if (t.kind !== "vote") continue;
      expect(t.options.length, t.key).toBeGreaterThanOrEqual(2);
      if (t.phase !== "proposed") expect(t.ballots?.length, t.key).toBe(t.options.length);
      if (t.phase === "open") {
        expect(t.opens_at!, t.key).toBeLessThan(0);
        expect(t.closes_at!, t.key).toBeGreaterThan(0);
      }
      if (t.phase === "closed") expect(t.closes_at!, t.key).toBeLessThan(0);
    }
  });

  it("reports only votes it seeds, with the outcome's numbers matching the ballots", () => {
    for (const t of SAMPLE_TEMPLATES) {
      if (t.kind !== "outcome") continue;
      const source = SAMPLE_TEMPLATES.find((x) => x.key === t.source);
      expect(source?.kind, t.key).toBe("vote");
      if (source?.kind !== "vote") continue;
      expect(source.phase).toBe("closed");
      expect(source.ballots!.reduce((a, b) => a + b, 0)).toBe(t.participation_count);
    }
  });

  it("fits a school district with only what reads right there", () => {
    expect(templatesFor("school_district").map((t) => t.key).sort()).toEqual(
      ["announcement_budget_hearing", "outcome_library_hours", "vote_library_hours"].sort(),
    );
    // No type set reads as a general-purpose local government.
    expect(templatesFor(null).length).toBe(templatesFor("other").length);
  });

  it("fills the placeholders and nothing else", () => {
    const names = { HUB_NAME: "Example Civic Hub", JURISDICTION: "Example County", GOVERNING_BODY: "County Commission" };
    expect(fillSample("{JURISDICTION} and the {GOVERNING_BODY} at {HUB_NAME}; {OTHER}", names)).toBe(
      "Example County and the County Commission at Example Civic Hub; {OTHER}",
    );
  });
});

describe("the governing body the console suggests", () => {
  it("follows the jurisdiction type, and a county's state", () => {
    expect(defaultGoverningBody("county", "us-va-example")).toBe("Board of Supervisors");
    expect(defaultGoverningBody("county", "us-nc-example")).toBe("County Commission");
    expect(defaultGoverningBody("county", null)).toBe("County Commission");
    expect(defaultGoverningBody("city")).toBe("City Council");
    expect(defaultGoverningBody("town")).toBe("Town Council");
    expect(defaultGoverningBody("village")).toBe("Village Board");
    expect(defaultGoverningBody("school_district")).toBe("School Board");
    expect(defaultGoverningBody("other")).toBe("");
    expect(defaultGoverningBody(null)).toBe("");
  });

  it("knows its own types", () => {
    for (const t of JURISDICTION_TYPES) expect(isJurisdictionType(t.id)).toBe(true);
    expect(isJurisdictionType("parish")).toBe(false);
  });
});
