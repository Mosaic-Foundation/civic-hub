// Dev server entry point — imports the Express app and starts listening.
// In production (Vercel), the app is imported by api/index.ts instead.

import { env } from "./config/env.js";
import app from "./app.js";

const PORT = parseInt(env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`\n🏛️  Civic Hub running at http://localhost:${PORT}`);
  console.log(`   Discovery: http://localhost:${PORT}/.well-known/civic.json`);
  console.log(`   Events:    http://localhost:${PORT}/events`);
  console.log(`   Seed data: http://localhost:${PORT}/debug/seed\n`);
});
