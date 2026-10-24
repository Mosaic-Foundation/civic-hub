// Every adapter's fake, together (ADR-012): what CIVIC_FAKE_ADAPTERS=on
// installs (src/hosting/index.ts), what the unit suite installs before each
// file (tests/setup/adapters.ts), and the run-anywhere job's set. The
// deliberation fake is the fake Polis (src/hosting/polis.ts), which the
// hosting layer chooses; the object store stays the deployment's own unless
// CIVIC_OBJECT_STORE=memory, because the local stack's storage is local.

import type { Adapters } from "../index.js";
import { fakeAi } from "./ai.js";
import { fakeMail } from "./mail.js";
import { fakeVideo } from "./video.js";
import { fakeErrors } from "./errors.js";
import { fakeHeartbeat } from "./heartbeat.js";
import { memoryObjectStore } from "./objectStore.js";

export { fakeAi, fakeMail, fakeVideo, fakeErrors, fakeHeartbeat, memoryObjectStore };

export function fakeAdapters(): Omit<Adapters, "deliberation"> {
  return {
    ai: fakeAi(),
    mail: fakeMail(),
    video: fakeVideo(),
    errors: fakeErrors(),
    heartbeat: fakeHeartbeat(),
    objectStore: memoryObjectStore(),
  };
}
