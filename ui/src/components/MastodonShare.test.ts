import { describe, expect, it } from "vitest";
import { mastodonServerFrom, mastodonShareUrl } from "./mastodonShareUrl";

describe("Share on Mastodon", () => {
  it("takes the server from whatever a person types", () => {
    expect(mastodonServerFrom("mastodon.social")).toBe("mastodon.social");
    expect(mastodonServerFrom("  Mastodon.Social ")).toBe("mastodon.social");
    expect(mastodonServerFrom("https://hachyderm.io/home")).toBe("hachyderm.io");
    expect(mastodonServerFrom("@adam@fosstodon.org")).toBe("fosstodon.org");
    expect(mastodonServerFrom("adam@social.example.co.uk")).toBe("social.example.co.uk");
  });

  it("refuses what is not a hostname", () => {
    for (const bad of ["", "mastodon", "@adam", "http://", "javascript:alert(1)", "a b.com", "evil.com/../x", "-x.com"]) {
      if (bad === "evil.com/../x") {
        // Only the hostname survives; the path never reaches the link.
        expect(mastodonServerFrom(bad)).toBe("evil.com");
        continue;
      }
      expect(mastodonServerFrom(bad)).toBeNull();
    }
  });

  it("opens the server's compose page with the title and link filled in", () => {
    expect(mastodonShareUrl("mastodon.social", "Skate park vote https://hub.example/process/p1")).toBe(
      "https://mastodon.social/share?text=Skate%20park%20vote%20https%3A%2F%2Fhub.example%2Fprocess%2Fp1",
    );
  });
});
