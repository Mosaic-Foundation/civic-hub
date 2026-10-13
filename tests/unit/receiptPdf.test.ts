import { describe, expect, it } from "vitest";
import {
  buildReceiptPdf,
  COUNTED_ONLY_LINE,
  KEEP_PRIVATE_LINE,
  longDay,
  receiptFileName,
  type ReceiptFileInput,
} from "../../src/shared/receiptPdf.js";

const base: ReceiptFileInput = {
  hubName: "Test Civic Hub",
  voteTitle: "Should the café (old depot) open on Sundays?",
  votedOn: "2026-10-13",
  code: "3f8a2c1e-7b9d-4e5f-a1b2-c3d4e5f6a7b8",
  checkUrl: "https://hub.example.test/votes/proc_abc/log#receipt=3f8a2c1e-7b9d-4e5f-a1b2-c3d4e5f6a7b8",
  mode: "show_choice",
};

// A small checkerboard stands in for a QR code.
const qr = Array.from({ length: 21 }, (_, r) => Array.from({ length: 21 }, (_, c) => (r + c) % 2 === 0));

const text = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("the receipt PDF", () => {
  it("is a well-formed PDF: every object where the cross-reference table says", () => {
    const pdf = text(buildReceiptPdf(base, qr));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(7);
    offsets.forEach((off, i) => expect(pdf.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(pdf)![1]);
    const stream = pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("\nendstream"));
    expect(stream.length).toBe(length);
  });

  it("carries the vote, the date, the code, the check address and the QR code", () => {
    const pdf = text(buildReceiptPdf(base, qr));
    expect(pdf).toContain(base.code);
    expect(pdf).toContain("Voted on October 13, 2026");
    // Parentheses escaped; é written in WinAnsi.
    expect(pdf).toContain("caf\\351 \\(old depot\\)");
    expect(pdf).toContain("#receipt=3f8a2c1e");
    expect((pdf.match(/ re f$/gm) ?? []).length).toBe(221); // the dark squares
  });

  it("show the choice says to keep it private; counted only says it shows nothing more", () => {
    const shown = text(buildReceiptPdf(base, qr));
    expect(shown).toContain("Keep this private; anyone with this code can see how this ballot was cast.");
    expect(shown).not.toContain(COUNTED_ONLY_LINE);
    const counted = text(buildReceiptPdf({ ...base, mode: "counted_only" }, qr));
    expect(counted).toContain(COUNTED_ONLY_LINE);
    expect(counted).not.toContain(KEEP_PRIVATE_LINE);
  });

  it("a long code or address wraps instead of running off the page", () => {
    const pdf = text(buildReceiptPdf({ ...base, checkUrl: `https://hub.example.test/${"x".repeat(300)}` }, qr));
    const urlLines = pdf.split("\n").filter((l) => l.includes("/F2 8 Tf"));
    expect(urlLines.length).toBeGreaterThan(1);
  });

  it("is named by vote and date, safely", () => {
    expect(receiptFileName('A "big" question: yes/no?', "2026-10-13")).toBe("Vote receipt - A big question yes no - 2026-10-13.pdf");
    expect(longDay("2026-01-05")).toBe("January 5, 2026");
  });
});
