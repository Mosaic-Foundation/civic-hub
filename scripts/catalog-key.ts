// npx tsx scripts/catalog-key.ts new | vercel env add CIVIC_CATALOG_SIGNING_KEY production --sensitive --force
//
// Makes a new catalog signing key (ADR-015): an Ed25519 private key, PEM, for
// one deployment's CIVIC_CATALOG_SIGNING_KEY. It writes the key only into a
// pipe, so it goes straight into the host's settings and never to a file, a
// screen or a clipboard: it refuses when its output is a terminal. (macOS's
// own openssl has no Ed25519, so the key is made with Node's crypto.)
//
// The key's id and public half are shown on the console's Plugins page once
// the deployment runs with it.

import { generateKeyPairSync } from "node:crypto";

if (process.argv[2] !== "new") {
  console.error("usage: npx tsx scripts/catalog-key.ts new | vercel env add CIVIC_CATALOG_SIGNING_KEY <environment> --sensitive --force");
  process.exit(2);
}
if (process.stdout.isTTY) {
  console.error("catalog-key: refusing to print a private key to the terminal. Pipe it into `vercel env add` (see the usage line).");
  process.exit(2);
}
process.stdout.write(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString());
