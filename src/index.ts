// Dev server entry point — imports the Express app and starts listening.
// In production (Vercel), the app is imported by api/index.ts instead.

// First, and the app only after it: a package imports the plugin SDK by name,
// which `npm start`'s compiled dist/ resolves through this (sdkResolve.ts).
import "./sdkResolve.js";

const { env } = await import("./config/env.js");
const { default: hubApp } = await import("./app.js");
const { withConsole } = await import("./control/index.js");

// The super admin on CIVIC_CONSOLE_HOSTNAME (console.localhost locally);
// every other host is the hub app. See src/control/index.ts.
const app = withConsole(hubApp);

const PORT = parseInt(env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`\n🏛️  Civic Hub running at http://localhost:${PORT}`);
  console.log(`   Discovery: http://localhost:${PORT}/.well-known/civic.json`);
  console.log(`   Events:    http://localhost:${PORT}/events`);
  console.log(`   Seed data: http://localhost:${PORT}/debug/seed\n`);
});
