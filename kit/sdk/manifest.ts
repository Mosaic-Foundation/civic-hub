// @civic-social/plugin-sdk/manifest: what a package's manifest.ts imports
// (plain data the hub's server and its UI both read; ADR-009, ADR-015).

export { defineDescriptor, defineManifest } from "../../src/processes/manifest.js";
export type { ProcessManifest } from "../../src/processes/manifest.js";
export { DEADLINE_CLOSE_INPUT } from "../../src/shared/deadlineClose.js";
export type { ParticipationDeclaration, MeasureId } from "../../src/shared/participation.js";
