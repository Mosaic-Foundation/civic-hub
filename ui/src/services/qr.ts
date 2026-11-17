// A QR code's modules (true = dark), row by row, for text: what a page draws
// or writes into a file (a vote's receipt). qrcode-generator (MIT, no
// dependencies) is loaded only when one is made.

export async function qrMatrix(text: string): Promise<boolean[][]> {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
