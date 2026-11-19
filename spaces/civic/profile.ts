// The civic profile (docs/KERNEL.md §3, kernel step 2): what a Civic Hub
// calls the kernel's roles and words. Kept small on purpose: the space's
// name, a name for each kernel role, and the kernel's terms. A field joins
// only when two space types need it or a screen cannot be written without it
// (credential types join with identity phase 3).
//
// Every word here is what the hub already said before the profile existed,
// so nothing on screen changes.
//
// Shared by the server and the UI. Pure data. Part of the Civic Hub space
// type (./type.ts), which the deployment picks in config/plugins.json.

import type { SpaceProfile } from "../../src/shared/spaceProfile.js";

export const CIVIC_PROFILE: SpaceProfile = {
  id: "civic",
  space: { one: "hub", many: "hubs" },
  roles: {
    member: "resident",
    moderator: "moderator",
    admin: "admin",
    accountable: "official",
  },
  terms: {
    // Residents of a place hub, members of an organization or community,
    // participants anywhere else: a campaign has no residents and no members
    // (Adam, 2026-10-06).
    member: { place: "resident", organization: "member", community: "member", "*": "participant" },
    accountable: "official",
    space: "hub",
  },
};
