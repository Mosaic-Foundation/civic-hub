// The console's refusal of its own input, in the hub's error shape
// ({ error, code }; src/errors/). The hub's side has its own
// (src/operator/hubs.ts); a refusal from the operator API arrives as a
// CivicError either way.

import { CivicError, codeForStatus } from "../errors/index.js";

export class ControlInputError extends CivicError {
  constructor(message: string, status = 400) {
    super(status, codeForStatus(status), message);
  }
}
