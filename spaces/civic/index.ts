// The Civic Hub space type (kernel step 3; docs/kernel/SURFACE.md, "Space
// types"): what makes the Mosaic Space Kernel a Civic Hub, beyond the plugins
// a hub runs. Today: the words of the curated sample content a new hub starts
// with (./sampleTemplates.ts; each plugin seeds its own type) and the
// development seed (./dev/). The hosting layer names it in config/space.ts.
//
// A space type is not a plugin package: it may use the kernel's own modules
// and the packages it curates, but loads a package's code only where it uses
// it (await import()), never as the hub starts (ADR-017; eslint
// `civic/package-boundary`). Its heavy parts load the same way.

import type { SpaceServer } from "../../src/plugins/space.js";
import { civicSamplePlan, civicSamples } from "./samplePlan.js";
import { kindsWithSamples, samplePreviews } from "./sampleTemplates.js";

const civicHub: SpaceServer = {
  name: "Civic Hub",
  samples: {
    plan: civicSamplePlan,
    all: civicSamples,
    kinds: kindsWithSamples,
    previews: samplePreviews,
  },
  dev: {
    async seedEmptyHub(hubId) {
      const { seedEmptyHub } = await import("./dev/devSeed.js");
      return seedEmptyHub(hubId);
    },
    async seedAfterReset() {
      const { seedAfterReset } = await import("./dev/devSeed.js");
      return seedAfterReset();
    },
  },
};

export default civicHub;
