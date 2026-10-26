// Requests with an explicit Host header: the hostname is the variable under
// test, and fetch() will not let a caller set Host. node:http will. The
// conformance suite's own helper (kit/conformance), shared by every API test.

export { call, callAt, type HostResponse } from "../../kit/conformance/src/support/http.js";
