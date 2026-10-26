// Before the suite's own process reads the hub's engine: the in-memory
// adapters and the modules' stores, as the hub's own tests bind them, and
// every loaded package counted as mounted here (the test host itself runs
// the package unverified: it has no catalog entry yet).

import { fakeAdapters, installAdapters, installStores, mountEverythingForTests } from "@civic-social/plugin-sdk/testing";

installAdapters(fakeAdapters());
installStores();
mountEverythingForTests(true);
