// Account ids (`user_` + 16 hex) belong to their owner and the hub's admins.
// accountIds.test.ts and the conformance suite check every answer a resident
// or a visitor gets against this. The conformance suite's own helper (kit/conformance).

export { accountIdOf, foreignIds } from "../../kit/conformance/src/support/accountIds.js";
