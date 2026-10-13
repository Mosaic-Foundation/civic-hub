// The vote receipt as a file (Actions slice, 2026-10-13, Adam).
//
// After voting, the resident can download their receipt: a one-page PDF this
// browser writes itself (src/shared/receiptPdf.ts), titled by the vote and
// the date, carrying the receipt code and a QR code that opens the check page
// with the code filled in: /votes/:id/log#receipt=<code>. The fragment is
// never sent to a server, so no request log records the code.
//
// The QR code comes from qrcode-generator (MIT, no dependencies), loaded only
// when a receipt is downloaded.

import { buildReceiptPdf, receiptFileName, type QrMatrix, type ReceiptFileInput } from "../../../src/shared/receiptPdf";

/** The QR code's modules for `text` (the library is loaded on first use). */
export async function qrMatrix(text: string): Promise<QrMatrix> {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** Write the receipt and hand it to the browser as a download. */
export async function downloadReceipt(input: ReceiptFileInput): Promise<void> {
  const bytes = buildReceiptPdf(input, await qrMatrix(input.checkUrl));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = receiptFileName(input.voteTitle, input.votedOn);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
