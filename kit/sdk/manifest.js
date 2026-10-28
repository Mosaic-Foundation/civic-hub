// Written by `npm run sdk:build` from manifest.ts. Do not edit (ADR-017).
// Standalone: a manifest is read before any package loads, and in the browser.

export function defineDescriptor(descriptor) {
  return descriptor;
}

export function defineManifest(manifest) {
  return manifest;
}

export const DEADLINE_CLOSE_INPUT = {
  "type": "object",
  "properties": {
    "note": {
      "type": "string",
      "maxLength": 1000,
      "description": "Why it is closing early. Required when an admin closes it before its deadline."
    }
  },
  "examples": [
    {
      "note": "Closed early by the conformance suite."
    }
  ]
};
