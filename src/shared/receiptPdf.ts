// The vote receipt's PDF (Actions slice, 2026-10-13, Adam): one Letter page,
// written with no library, so the browser makes it and nothing is sent
// anywhere. The UI adds the QR code's modules and starts the download
// (ui/src/services/receiptFile.ts). Pure, so it is tested without a browser.
//
// No choice is on the file: the code stays the same when the vote is
// changed, so the file stays right. On a "show the choice" vote it says to
// keep it private, since anyone with the code can see how the ballot was
// cast once the vote closes.

import type { CheckMode } from "./checkMode.js";

export interface ReceiptFileInput {
  hubName: string;
  voteTitle: string;
  /** The day the ballot was last cast from this browser (YYYY-MM-DD), else today. */
  votedOn: string;
  code: string;
  /** The check page with the code in its fragment. */
  checkUrl: string;
  mode: CheckMode;
}

/** The QR code's dark modules, row by row. */
export type QrMatrix = boolean[][];

export const KEEP_PRIVATE_LINE = "Keep this private; anyone with this code can see how this ballot was cast.";
export const COUNTED_ONLY_LINE = "This code shows only that your ballot was counted. It never shows how you voted.";

/** "October 13, 2026" from "2026-10-13". */
export function longDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "Vote receipt - <vote> - 2026-10-13.pdf", safe on every system. */
export function receiptFileName(voteTitle: string, votedOn: string): string {
  const title = voteTitle
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `Vote receipt - ${title || "vote"} - ${votedOn}.pdf`;
}

// --- The PDF -----------------------------------------------------------------
//
// One Letter page, Helvetica and Courier (standard fonts, nothing embedded),
// text and filled squares, uncompressed. Text is written in WinAnsi; a
// character outside it is written as "?".

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;

/** WinAnsi bytes for a string (Latin-1 plus the curly quotes and dashes). */
function winAnsi(text: string): number[] {
  const extra: Record<string, number> = {
    "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
    "–": 0x96, "—": 0x97, "…": 0x85, "•": 0x95, "€": 0x80,
  };
  const out: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (extra[ch] !== undefined) out.push(extra[ch]);
    else if (code >= 0x20 && code <= 0x7e) out.push(code);
    else if (code >= 0xa0 && code <= 0xff) out.push(code);
    else out.push(0x3f); // "?"
  }
  return out;
}

/** A PDF string literal of WinAnsi bytes, escaped. */
function pdfString(text: string): string {
  return (
    "(" +
    winAnsi(text)
      .map((b) => {
        if (b === 0x28 || b === 0x29 || b === 0x5c) return "\\" + String.fromCharCode(b);
        if (b < 0x20 || b > 0x7e) return "\\" + b.toString(8).padStart(3, "0");
        return String.fromCharCode(b);
      })
      .join("") +
    ")"
  );
}

/**
 * Lines of at most `width` points. A character is about 0.55 of the font
 * size in Helvetica (generous, for capitals) and exactly 0.6 in Courier.
 */
function wrap(text: string, size: number, width: number, perChar = 0.55): string[] {
  const max = Math.max(10, Math.floor(width / (size * perChar)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (word.length > max) {
      if (line) lines.push(line);
      for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max));
      line = "";
      continue;
    }
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The receipt as PDF bytes, given its QR code's modules. Pure: no browser needed. */
export function buildReceiptPdf(input: ReceiptFileInput, qr: QrMatrix): Uint8Array<ArrayBuffer> {
  const ops: string[] = [];
  let y = PAGE_H - MARGIN;
  const width = PAGE_W - 2 * MARGIN;

  const text = (s: string, font: "F1" | "F2" | "F3", size: number, gap = 6) => {
    for (const line of wrap(s, size, width, font === "F2" ? 0.6 : 0.55)) {
      y -= size;
      ops.push(`BT /${font} ${size} Tf ${MARGIN} ${y.toFixed(1)} Td ${pdfString(line)} Tj ET`);
      y -= 3;
    }
    y -= gap;
  };

  text(input.hubName, "F1", 11, 4);
  text("Vote receipt", "F3", 22, 10);
  text(input.voteTitle, "F3", 14, 4);
  text(`Voted on ${longDay(input.votedOn)}`, "F1", 11, 14);
  text("Receipt code", "F1", 10, 2);
  text(input.code, "F2", 13, 14);

  // The QR code: about two inches square, with a quiet zone of 4 modules.
  const n = qr.length;
  const side = 150;
  const cell = side / (n + 8);
  const left = MARGIN;
  const top = y - 4;
  ops.push("0 g");
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr[r][c]) continue;
      const x = left + (c + 4) * cell;
      const yy = top - (r + 5) * cell;
      ops.push(`${x.toFixed(2)} ${yy.toFixed(2)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f`);
    }
  }
  y = top - side - 10;

  text("Scan it, or open the address below, to check your receipt after the vote closes.", "F1", 10, 2);
  text(input.checkUrl, "F2", 8, 14);
  // 10pt bold keeps either sentence on one line.
  text(input.mode === "show_choice" ? KEEP_PRIVATE_LINE : COUNTED_ONLY_LINE, "F3", 10, 4);
  text(
    "The hub keeps nothing that links you to your ballot. This file and the browser you voted from are the only places that do.",
    "F1",
    9,
    0,
  );

  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  // Every byte below is ASCII (the strings above are escaped), so a string's
  // length is its byte length and the offsets are exact.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(new ArrayBuffer(pdf.length));
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}

