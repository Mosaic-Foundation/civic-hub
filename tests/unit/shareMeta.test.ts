// Social previews are registry-driven: GET /share/meta resolves any detail
// page through the process registry, and api/og.ts serves that to crawlers.
// These tests pin the seam — including the one that bit us: a section
// (/brief) whose handler had a detailPath but no vercel.json rewrite, so
// Facebook saw the generic hub card.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getAllHandlers, processDetailPath } from "../../src/processes/registry.js";
import {
  buildShareMeta,
  findShareImage,
  parseDetailPath,
} from "../../src/services/shareMeta.js";
import type { Process } from "../../src/models/process.js";

function proc(over: Partial<Process> & { type?: string }): Process {
  const { type = "civic.vote", ...rest } = over;
  return {
    id: "proc_1",
    definition: { type, version: "0.1" },
    title: "Should the county allow a farm stand?",
    description: "A short description of the question.",
    status: "active",
    hubId: "hub",
    jurisdiction: "local",
    createdBy: "user_1",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    state: {},
    ...rest,
  } as Process;
}

describe("vercel.json routes every registered detail section to api/og", () => {
  const vercel = JSON.parse(
    readFileSync(resolve(__dirname, "../../vercel.json"), "utf-8"),
  ) as { rewrites: Array<{ source: string; destination: string }> };
  const ogSections = new Set(
    vercel.rewrites
      .filter((r) => r.destination === "/api/og")
      .map((r) => r.source.split("/")[1]),
  );

  for (const handler of getAllHandlers()) {
    it(`${handler.type} → ${processDetailPath(handler.type, "x")}`, () => {
      const section = processDetailPath(handler.type, "x").split("/")[1];
      expect(ogSections.has(section)).toBe(true);
    });
  }
});

describe("parseDetailPath", () => {
  it("accepts /section/id and strips query/hash", () => {
    expect(parseDetailPath("/brief/proc_1?id=proc_1#x")).toEqual({ section: "brief", id: "proc_1" });
  });
  it("rejects anything that is not exactly two segments", () => {
    expect(parseDetailPath("/")).toBeNull();
    expect(parseDetailPath("/votes")).toBeNull();
    expect(parseDetailPath("/votes/proc_1/log")).toBeNull();
    expect(parseDetailPath("/admin/reviews/../x")).toBeNull();
  });
});

describe("buildShareMeta — generic default", () => {
  it("uses the row's title and description and the handler's canonical path", () => {
    const m = buildShareMeta("/process/proc_1", proc({}));
    expect(m).toEqual({
      title: "Should the county allow a farm stand?",
      description: "A short description of the question.",
      image: null,
      path: "/process/proc_1",
    });
  });

  it("falls back to the title when the description is empty", () => {
    expect(buildShareMeta("/process/proc_1", proc({ description: "" }))?.description).toBe(
      "Should the county allow a farm stand?",
    );
  });

  it("trims a long description at a word boundary", () => {
    const long = "word ".repeat(80).trim();
    const d = buildShareMeta("/process/proc_1", proc({ description: long }))!.description;
    expect(d.length).toBeLessThanOrEqual(201);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/ …$/);
  });

  it("picks up the first *image_url on state, state.content, or content", () => {
    expect(findShareImage(proc({ state: { image_url: "/a.jpg" } }))).toBe("/a.jpg");
    expect(findShareImage(proc({ state: { content: { image_url: "/b.jpg" } } }))).toBe("/b.jpg");
    expect(
      findShareImage(proc({ content: { banner_image_url: "https://x/c.jpg" } as never })),
    ).toBe("https://x/c.jpg");
    expect(findShareImage(proc({ state: { banner_image_alt: "not an image" } }))).toBeNull();
  });

  it("resolves every registered type through its own detail path", () => {
    for (const handler of getAllHandlers()) {
      const p = proc({
        type: handler.type,
        state: { publication_status: "published", content: { headline: "H" } },
      });
      const path = processDetailPath(handler.type, p.id);
      expect(buildShareMeta(path, p)?.path).toBe(path);
    }
  });
});

describe("buildShareMeta — refusals", () => {
  it("refuses a section that is not this type's detail path", () => {
    expect(buildShareMeta("/proposal/proc_1", proc({ type: "civic.vote" }))).toBeNull();
    expect(buildShareMeta("/admin/proc_1", proc({}))).toBeNull();
  });
  it("refuses an id that does not match the loaded process", () => {
    expect(buildShareMeta("/process/proc_other", proc({}))).toBeNull();
  });
  it("refuses non-public statuses", () => {
    expect(buildShareMeta("/process/proc_1", proc({ status: "pending_review" }))).toBeNull();
    expect(buildShareMeta("/process/proc_1", proc({ status: "archived" }))).toBeNull();
  });
  it("refuses records with a publication workflow until published", () => {
    const pending = proc({
      type: "civic.brief",
      state: { publication_status: "pending", content: { headline: "H" } },
    });
    expect(buildShareMeta("/brief/proc_1", pending)).toBeNull();
  });
});

describe("buildShareMeta — brief and vote results carry their headline", () => {
  for (const type of ["civic.brief", "civic.vote_results"]) {
    it(`${type}: headline as description, row title kept, unpublished refused`, () => {
      const published = proc({
        type,
        description: "",
        state: {
          publication_status: "published",
          content: { headline: "Critical services come first", image_url: "/brief.jpg" },
        },
      });
      const path = processDetailPath(type, "proc_1");
      expect(buildShareMeta(path, published)).toEqual({
        title: "Should the county allow a farm stand?",
        description: "Critical services come first",
        image: "/brief.jpg",
        path,
      });
      expect(
        buildShareMeta(path, proc({ type, state: { publication_status: "approved" } })),
      ).toBeNull();
    });
  }
});
