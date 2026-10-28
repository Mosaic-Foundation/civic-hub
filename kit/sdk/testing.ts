// @civic-social/plugin-sdk/testing: what the conformance suite
// (@civic-social/plugin-conformance) reads of the hub's engine in its own
// process, beside the HTTP it talks to the test host with: the descriptor
// check and the hub's lists it checks against, the wire's serializer and
// redaction, the registry's view of the type under test. Not for a package:
// a package imports `@civic-social/plugin-sdk` only.

export { HOST_EVENT_TYPES, allowedTargets } from "../../src/processes/descriptor.js";
export type { ActionDescriptor, ProcessTypeDescriptor } from "../../src/processes/descriptor.js";
export { checkDescriptor } from "../../src/processes/descriptorCheck.js";
export type { HostFacts } from "../../src/processes/descriptorCheck.js";
export type { ProcessHandler } from "../../src/processes/types.js";
export type { ProcessStatus } from "../../src/models/process.js";
export type { Hub as HubModel } from "../../src/models/hub.js";
export { JOBS, JOBS_MOUNT } from "../../src/jobs/registry.js";
export { getAllHandlers, getManifest } from "../../src/processes/registry.js";
export { rowToEvent } from "../../src/events/eventStore.js";
export type { EventRow } from "../../src/events/eventStore.js";
export { toActivity, mappedEventTypes } from "../../src/events/activitySerializer.js";
export { AS2_TERMS } from "../../src/shared/as2Terms.js";
export { toRedactedActivity } from "../../src/events/publicRedaction.js";
export { publicPayloadKeys } from "../../src/events/publicPayload.js";
export { withHubScope } from "../../src/config/hubContext.js";
export { PROCESS_PLUGIN_IDS } from "../../src/models/hubSettings.js";
export { HUB_TABLES } from "../../src/db/forHub.js";
export { EXPORT_MANIFEST } from "../../src/db/schemaContract.js";
export { loadedPackages } from "../../src/plugins/loader.js";
export { notAdditive } from "../../src/plugins/additive.js";
export { hashPackage } from "../../src/plugins/hash.js";
// What counts as participation (ADR-016): the declaration's check and the host's own events.
export { participationProblem, HOST_PARTICIPATION } from "../../src/shared/participation.js";
// The fake Code of Conduct check's markers (the test host runs CIVIC_FAKE_ADAPTERS=on).
export { FAKE_COC_DOWN, FAKE_COC_FLAG } from "../../src/debug/fakeCodeOfConduct.js";
// The in-memory adapters and stores the suite's own process binds, as the hub's tests do.
export { installAdapters } from "../../src/adapters/index.js";
export { fakeAdapters } from "../../src/adapters/fakes/index.js";
export { installStores } from "../../src/stores/index.js";
export { mountEverythingForTests } from "../../src/plugins/mountedState.js";
// Steps 11 to 17 (engine 2, ADR-017): what the SDK v1 surface promises.
export { namesFor, namesShown, disclosurePolicyOf } from "../../src/services/disclosedNames.js";
export { typeStatusOf } from "../../src/processes/registry.js";
export { DECLARED_FEED_KINDS, classifyActivity } from "../../src/shared/feedActivity.js";
export { THEME_TYPE_KEYS, declaredTypeStylesheet } from "../../src/shared/theme.js";
