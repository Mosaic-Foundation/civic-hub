/**
 * The `shots` hub that screenshots.spec.ts photographs: sample content only,
 * on the LOCAL stack, with nothing from .env. Run once after a reset:
 *
 *   node --import tsx tests/e2e/screenshots/makeHub.ts
 */

import { execFileSync } from "node:child_process";

const LOCAL_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function script(...args: string[]): void {
  execFileSync("node", ["--import", "tsx", ...args], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_KEY,
      CIVIC_ADMIN_EMAILS: "admin@example.test",
    },
    stdio: "inherit",
  });
}

script("scripts/create-hub.ts", "--id", "shots", "--hostname", "shots.localhost", "--name", "Screenshot Hub",
  "--jurisdiction", "Sample County, Virginia", "--mode", "live");
script("scripts/seed-sample-content.ts", "--hub", "shots");
