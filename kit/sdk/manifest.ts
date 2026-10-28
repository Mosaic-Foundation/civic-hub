// @civic-social/plugin-sdk/manifest: what a package's manifest.ts imports
// (plain data the hub's server and its UI both read; ADR-009, ADR-015).
//
// Self-contained (ADR-017): a manifest is read before the hub loads any
// package, in the browser too, so nothing here needs the engine. The helpers
// return what they are given; their types are the engine's. The built
// manifest.js is generated from this file (`npm run sdk:build`).

import type { ProcessManifest } from "../../src/processes/manifest.js";
import type { ProcessTypeDescriptor } from "../../src/processes/descriptorTypes.js";
import { DEADLINE_CLOSE_INPUT as CLOSE_INPUT } from "../../src/shared/deadlineClose.js";

export type { ProcessManifest };
export type { ParticipationDeclaration, MeasureId } from "../../src/shared/participation.js";

/** Declare a process type's descriptor. Returns it as given, keeping its literal values. */
export function defineDescriptor<const P extends string>(descriptor: ProcessTypeDescriptor<P>): ProcessTypeDescriptor<P> {
  return descriptor;
}

/** Declare a manifest. Returns it as given, keeping its literal values. */
export function defineManifest<const M extends ProcessManifest>(manifest: M): M {
  return manifest;
}

/** The input every deadline type's close action takes (src/shared/deadlineClose.ts). */
export const DEADLINE_CLOSE_INPUT = CLOSE_INPUT;
