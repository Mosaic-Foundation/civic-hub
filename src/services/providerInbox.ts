// The provider's inbox (kernel step 4): a hub's way to write to the people
// who maintain its software (today Civic.Social), apart from anything the
// hub keeps. A kernel service, because it is the host's line to its provider,
// not a feature: Feedback (features/feedback) sends a resident's Bug or Idea
// through it, and an admin's "Contact Civic.Social" (Admin → Help) uses it
// with or without Feedback on.
//
// It writes one row in the platform's inbox (src/db/platformFeedback.ts) and
// never reads one: a hub cannot list the inbox, so a hub's admins never see
// another hub's messages. The hub's id and the running software's version are
// stamped here, not by the caller.

import { copyToMosaic, type MosaicCopyInput, type MosaicStatus } from "../db/platformFeedback.js";
import { currentHubId } from "../config/hubContext.js";
import { deploymentCommit } from "../config/deployment.js";
import { ValidationError } from "../errors/index.js";

/** What a caller sends: the platform's row, less what the kernel stamps. */
export type ProviderMessage = Omit<MosaicCopyInput, "hubId" | "softwareVersion"> & {
  /** The version the item was about, when it differs from the one running (a stored report's). */
  softwareVersion?: string | null;
};

const PAGE_PATH_MAX_LEN = 300;
const MESSAGE_MAX_LEN = 4000;
const UA_MAX_LEN = 500;

/**
 * The page a report is about: a path on this hub, with no query string or
 * fragment (they can carry a code or an address), capped. Anything that is
 * not a plain path is dropped rather than refused: the report still matters.
 */
export function normalizePagePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim().split(/[?#]/)[0];
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (!/^\/[A-Za-z0-9\-._~/%]*$/.test(path)) return null;
  return path.slice(0, PAGE_PATH_MAX_LEN);
}

export const providerInbox = {
  /** Write one message to the provider's inbox, for the hub in scope; its id and status there. */
  async send(message: ProviderMessage): Promise<{ id: string; status: MosaicStatus }> {
    return copyToMosaic({ ...message, hubId: currentHubId(), softwareVersion: message.softwareVersion ?? deploymentCommit() });
  },
  /** The running software's version (the deployed commit), to stamp on what a hub keeps. */
  softwareVersion(): string {
    return deploymentCommit();
  },
  normalizePagePath,
};

/**
 * "Contact Civic.Social": a hub admin writes to the provider directly. The
 * admin's address goes with it (the form says so), and nothing is stored on
 * the hub.
 */
export async function contactProvider(input: {
  message: unknown;
  /** The admin's address, when the account has one; without it nothing is offered to reply to. */
  adminEmail: string | null;
  pagePath?: unknown;
  userAgent?: string | null;
}): Promise<{ id: string }> {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new ValidationError("message is required");
  if (message.length > MESSAGE_MAX_LEN) throw new ValidationError(`message must be ${MESSAGE_MAX_LEN} characters or fewer`);
  const copy = await providerInbox.send({
    sourceFeedbackId: null,
    stream: "admin",
    origin: "admin",
    message,
    pagePath: normalizePagePath(input.pagePath),
    userAgent: input.userAgent?.slice(0, UA_MAX_LEN) ?? null,
    contactOk: input.adminEmail !== null,
    contactEmail: input.adminEmail,
  });
  return { id: copy.id };
}
