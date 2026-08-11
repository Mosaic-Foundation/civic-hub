import { describe, it, expect } from "vitest";
import { checkWordlist } from "../../src/shared/wordlist/index.js";

describe("checkWordlist", () => {
  describe("blocks egregious slurs", () => {
    it("catches a slur as a standalone word", () => {
      expect(checkWordlist("you are a faggot").blocked).toBe(true);
    });

    it("catches a slur regardless of case or trailing punctuation", () => {
      expect(checkWordlist("Retard!").blocked).toBe(true);
      expect(checkWordlist("what a CHINK.").blocked).toBe(true);
    });

    it("catches obvious leetspeak evasion", () => {
      expect(checkWordlist("n1gg3r").blocked).toBe(true);
      expect(checkWordlist("f4ggot").blocked).toBe(true);
    });

    it("catches repeated-character evasion", () => {
      expect(checkWordlist("faaaaggot").blocked).toBe(true);
    });

    it("catches spaced-out single-word evasion", () => {
      expect(checkWordlist("n i g g e r").blocked).toBe(true);
    });
  });

  describe("does NOT block civil dissent or innocent words (err toward allowing)", () => {
    const allowed = [
      // General profanity is civil speech here — never blocked.
      "This policy is absolute bullshit and the Board should be ashamed.",
      "I am furious about this decision. It's a damn disgrace.",
      "Screw the new zoning rules, they hurt working families.",
      // The Scunthorpe problem — innocent words that contain slur substrings.
      "The assessment covers Scunthorpe and the surrounding class areas.",
      "We analyzed the class roster and the cognate assessment.",
      "Please cc the county administrator on that thread.",
      "The cocoon of the moth was on the porch.",
      // Sharp but civil criticism of people and groups.
      "The supervisors are being dishonest and self-serving.",
      "I strongly disagree with everyone who supports this.",
      // Substrings that are not the slur as a whole word.
      "He is a specialist in Spectroscopy.",
    ];

    for (const text of allowed) {
      it(`allows: ${text.slice(0, 40)}...`, () => {
        expect(checkWordlist(text).blocked).toBe(false);
      });
    }
  });

  it("allows empty / whitespace input", () => {
    expect(checkWordlist("").blocked).toBe(false);
    expect(checkWordlist("   ").blocked).toBe(false);
  });
});
