// Every test file starts with the in-memory adapters installed, and the
// modules' stores bound (ADR-012):
// nothing in the unit suite, or the API suite's in-process parts, can reach
// Anthropic, Resend, YouTube, Polis, Sentry, Healthchecks.io or Storage. A test
// that needs a particular implementation installs it (installAdapters).
//
// The API suite's server is a separate process; CI and Playwright start it
// with CIVIC_FAKE_ADAPTERS=on for the same reason.

import { installAdapters } from "../../src/adapters/index.js";
import { fakeAdapters } from "../../src/adapters/fakes/index.js";
import { fakePolisService } from "../../src/hosting/polis.js";
import { installStores } from "../../src/stores/index.js";

installAdapters({ ...fakeAdapters(), deliberation: fakePolisService });
// The modules' stores, as the app binds them (they still reach the database
// through forHub(), which a unit test mocks as before).
installStores();
