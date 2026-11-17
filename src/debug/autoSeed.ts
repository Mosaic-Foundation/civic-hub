// Auto-seed on startup — ensures dev scenarios are loaded. The scenarios are
// the space type's (SpaceServer.dev, config/space.ts; the Civic Hub's are in
// spaces/civic/dev/); this is the kernel's gate around them.
//
// Gated behind CIVIC_ALLOW_SEED=true. Set this in your local .env. Leave it
// unset in the Vercel Production environment so production data is never
// wiped by a seed run.
//
// Seeding is idempotent per serverless instance: if processes already exist
// in the in-memory store, we skip. On cold starts with a fresh instance,
// the guard is re-entered once.

import { seedAllowed } from "../config/devFlags.js";
import { getEventCount } from "../events/eventStore.js";
import { countProcessesInHub } from "../services/processRows.js";
import { currentHubIdOrNull } from "../config/hubContext.js";
import { spaceType } from "../plugins/spaceType.js";

function allowSeed(): boolean {
  // Never in production, whatever the env says (src/config/devFlags.ts).
  return seedAllowed();
}

// Memoize the seed run per hub so concurrent requests don't trigger duplicate
// seeding. Per hub since Phase 2a: processes are read per hub, so each hub is
// seeded — or found already seeded — on its own first request, in its scope.
const seedPromises = new Map<string, Promise<void>>();

export async function seedOnStartup(): Promise<void> {
  if (!allowSeed()) return;
  // /health and /internal/* run with no hub in scope: nothing to seed.
  const hubId = currentHubIdOrNull();
  if (!hubId) return;
  const pending = seedPromises.get(hubId);
  if (pending) return pending;

  const seedPromise = (async () => {
    // Skip seeding if this hub already has processes.
    const count = await countProcessesInHub(hubId);
    if (count > 0) {
      const evCount = await getEventCount();
      console.log(
        `[auto-seed] Skipping — ${count} process(es) and ${evCount} event(s) already present. ` +
          `Use GET /debug/seed to reset and reseed.`,
      );
      return;
    }

    // What a hub is seeded with is its space type's (kernel step 3).
    const dev = spaceType()?.dev;
    if (!dev) return;
    await dev.seedEmptyHub(hubId);
    console.log("[auto-seed] Done\n");
  })().catch((err) => {
    console.error("[auto-seed] failed:", err);
    // Reset so a later request can retry (e.g., transient DB error)
    seedPromises.delete(hubId);
    throw err;
  });

  seedPromises.set(hubId, seedPromise);
  return seedPromise;
}

/**
 * Express middleware — ensures seed data exists before handling a request.
 * No-op when CIVIC_ALLOW_SEED is unset. Safe under concurrent requests.
 */
export async function ensureSeeded(
  _req: unknown,
  _res: unknown,
  next: (err?: unknown) => void,
): Promise<void> {
  try {
    await seedOnStartup();
    next();
  } catch (err) {
    next(err);
  }
}
