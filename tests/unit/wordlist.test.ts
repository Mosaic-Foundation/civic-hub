import { describe, it, expect } from "vitest";
import {
  checkWordlist,
  assertPassesWordlist,
  PROFANITY_BLOCK_MESSAGE,
  WORDLIST_BLOCK_MESSAGE,
} from "../../src/shared/wordlist/index.js";

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

  // Adam, 2026-09-06: "using curse words is not an opinion". Strong profanity
  // is refused with its own, softer message; the slur message is unchanged.
  describe("blocks strong profanity", () => {
    it("catches the f-word in a sentence, in any form", () => {
      expect(checkWordlist("fuck this policy")).toMatchObject({ blocked: true, category: "profanity" });
      expect(checkWordlist("this is FUCKING ridiculous").blocked).toBe(true);
      expect(checkWordlist("what a motherfucker.").blocked).toBe(true);
    });

    it("catches the other strong ones", () => {
      for (const t of ["shit", "bullshit", "bitch", "asshole", "cunt", "twat"]) {
        expect(checkWordlist(`total ${t} here`).blocked, t).toBe(true);
      }
    });

    it("catches masked and leet spellings", () => {
      expect(checkWordlist("f*ck").blocked).toBe(true);
      expect(checkWordlist("sh1t").blocked).toBe(true);
      expect(checkWordlist("fuuuuck").blocked).toBe(true);
    });

    it("tells the two apart in the thrown message", () => {
      expect(() => assertPassesWordlist("fuck this")).toThrow(PROFANITY_BLOCK_MESSAGE);
      expect(() => assertPassesWordlist("you faggot")).toThrow(WORDLIST_BLOCK_MESSAGE);
    });

    it("still lets mild and ambiguous words through (whole-word, short list)", () => {
      for (const t of ["damn", "hell no", "pissed off", "crap", "Dick Jones spoke", "assess the class", "shiitake", "Scunthorpe"]) {
        expect(checkWordlist(t).blocked, t).toBe(false);
      }
    });
  });

  describe("does NOT block civil dissent or innocent words (err toward allowing)", () => {
    const allowed = [
      // General profanity is civil speech here — never blocked.
      "This policy is absolutely idiotic and the board should be ashamed of itself",
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
