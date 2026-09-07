// A URL typed without its scheme ("www.civic.social") is still a URL. It used
// to fall through every link parser: stored bare as {url: line, label: line},
// rendered as raw JSON on the submission page, and — if clicked — treated by
// the browser as a relative path on the hub (Adam, 2026-09-06).

import { describe, it, expect } from "vitest";
import { parseSourceLine, sourceLineToContentLink, normalizeUrl } from "../../src/shared/sourceLine.js";
import { fieldFor } from "../../src/shared/submissionPreview.js";

describe("scheme-less URLs", () => {
  it("normalizeUrl adds https:// only when missing", () => {
    expect(normalizeUrl("www.civic.social")).toBe("https://www.civic.social");
    expect(normalizeUrl("floydcountyva.gov/board.")).toBe("https://floydcountyva.gov/board");
    expect(normalizeUrl("http://example.org")).toBe("http://example.org");
  });

  it("parseSourceLine accepts a bare domain and labels it by hostname", () => {
    expect(parseSourceLine("www.civic.social")).toEqual({ url: "https://www.civic.social", label: "civic.social" });
    expect(parseSourceLine("County site: floydcountyva.gov")).toEqual({ url: "https://floydcountyva.gov", label: "County site" });
    expect(sourceLineToContentLink("www.civic.social").url).toBe("https://www.civic.social");
  });

  it("still returns null for a line with no URL in it", () => {
    expect(parseSourceLine("Just a sentence with no link")).toBeNull();
    expect(parseSourceLine("see the board minutes")).toBeNull();
  });

  it("the submission preview renders a stored bare-domain link as links, not JSON", () => {
    const field = fieldFor("links", [{ url: "www.civic.social", label: "www.civic.social" }], {});
    expect(field?.kind).toBe("links");
    // The preview labels a bare URL with the (now normalized) URL itself —
    // the rule its own tests pin; the live SourceLinks renderer titles it.
    expect(field?.value).toEqual([{ url: "https://www.civic.social", label: "https://www.civic.social" }]);
  });
});
