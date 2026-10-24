// Print a service-role key for a bare PostgREST (docs/RUN-ANYWHERE.md): a JWT
// with `role: service_role`, signed HS256 with PostgREST's jwt-secret. It is
// the hub's SUPABASE_SERVICE_ROLE_KEY there. Keep it secret: it bypasses RLS.
//
//   node scripts/run-anywhere/service-key.mjs <jwt-secret>

import { createHmac } from "node:crypto";

const secret = process.argv[2];
if (!secret || secret.length < 32) {
  console.error("usage: service-key.mjs <jwt-secret of 32 characters or more>");
  process.exit(1);
}
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const head = b64({ alg: "HS256", typ: "JWT" });
const body = b64({ role: "service_role", iss: "civic-hub", iat: Math.floor(Date.now() / 1000), exp: 4102444800 });
const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
process.stdout.write(`${head}.${body}.${sig}\n`);
