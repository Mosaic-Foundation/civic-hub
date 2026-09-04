import { describe, it, expect } from "vitest";
import { parseSourceLine, sourceLineToContentLink } from "../../src/shared/sourceLine";

describe("source lines — title is the link, URL is the href", () => {
  // The five sources on the microgrid project Adam hit on 2026-09-04. Stored
  // correctly; it was the reader that used the whole line as the href.
  const real = [
    "DOE C-MAP program page: https://www.energy.gov/oe/community-microgrid-assistance-partnership",
    "DOE C-MAP FY26 fact sheet: https://www.energy.gov/sites/default/files/2026-06/doe-oe-cmap-factsheet_fy26.pdf",
    "Appalachian microgrids explainer (Reimagine Appalachia): https://reimagineappalachia.org/blog-title-what-are-microgrids/",
    "After Helene, rural NC turns to solar and battery hubs (Canary Media): https://www.canarymedia.com/articles/solar/rural-north-carolina-solar-battery-hubs",
  ];

  it("takes the title as the label and only the URL as the href", () => {
    const parsed = real.map(parseSourceLine);
    expect(parsed[0]).toEqual({
      label: "DOE C-MAP program page",
      url: "https://www.energy.gov/oe/community-microgrid-assistance-partnership",
    });
    for (const p of parsed) {
      expect(p).not.toBeNull();
      // The href must be a real absolute URL — anything else is resolved
      // relative to the hub and lands on a blank page.
      expect(() => new URL(p!.url)).not.toThrow();
      expect(p!.url.startsWith("http")).toBe(true);
      expect(p!.label).not.toContain("http");
    }
  });

  it("drops a trailing parenthetical from the label", () => {
    expect(parseSourceLine(real[2])!.label).toBe("Appalachian microgrids explainer");
    expect(parseSourceLine(real[3])!.label).toBe("After Helene, rural NC turns to solar and battery hubs");
  });

  it("falls back to the hostname when there is no title", () => {
    expect(parseSourceLine("https://www.energy.gov/oe/cmap")).toEqual({
      label: "energy.gov",
      url: "https://www.energy.gov/oe/cmap",
    });
  });

  it("strips trailing prose punctuation from the URL", () => {
    expect(parseSourceLine("A study: https://example.org/paper.")!.url).toBe(
      "https://example.org/paper",
    );
  });

  it("keeps a line with no URL rather than losing it", () => {
    expect(parseSourceLine("Ask at the county office")).toBeNull();
    expect(sourceLineToContentLink("Ask at the county office")).toEqual({
      url: "Ask at the county office",
      label: "Ask at the county office",
    });
  });

  it("stores a content link whose url is only the URL", () => {
    // The regression: {url: wholeLine, label: wholeLine} made the href a
    // relative path, so the link opened a blank hub page.
    expect(sourceLineToContentLink(real[0])).toEqual({
      label: "DOE C-MAP program page",
      url: "https://www.energy.gov/oe/community-microgrid-assistance-partnership",
    });
  });
});
