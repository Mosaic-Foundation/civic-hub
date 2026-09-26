// Dev server entry point — imports the Express app and starts listening.
// In production (Vercel), the app is imported by api/index.ts instead.

import hubApp from "./app.js";
import { withConsole } from "./control/index.js";

// The super admin on CIVIC_CONSOLE_HOSTNAME (console.localhost locally);
// every other host is the hub app. See src/control/index.ts.
const app = withConsole(hubApp);

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`\n🏛️  Civic Hub running at http://localhost:${PORT}`);
  console.log(`   Discovery: http://localhost:${PORT}/.well-known/civic.json`);
  console.log(`   Events:    http://localhost:${PORT}/events`);
  console.log(`   Seed data: http://localhost:${PORT}/debug/seed\n`);
});
