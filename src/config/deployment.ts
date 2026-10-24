// What this deployment is, for /health: the commit it runs and its
// deployment id.
//
// Vercel injects VERCEL_GIT_COMMIT_SHA and VERCEL_DEPLOYMENT_ID. A hub hosted
// anywhere else sets the generic names instead — GIT_COMMIT_SHA and
// DEPLOYMENT_ID — so a self-hosted /health answers the same questions without
// pretending to be on Vercel. The Vercel names win where both are set, which
// is only ever on Vercel.

import { env } from "./env.js";
export function deploymentCommit(): string {
  return (
    env.GIT_COMMIT_SHA ||
    "unknown"
  );
}

export function deploymentId(): string | null {
  return env.DEPLOYMENT_ID || null;
}
