import type { CommentIdentityMode } from "../services/api";
import { useHubSetting } from "../config/HubConfigContext";

/**
 * The hub's comment identity policy: whether a comment carries the author's
 * real name, may be anonymous at the author's option, or is always anonymous.
 *
 * Reads the config the app already fetched at boot. It used to make its own
 * request to /process/input/identity-mode on every mount of every comment
 * form — a round trip for a value the client was already holding, and a
 * second source of truth for one setting. That endpoint still exists as a
 * deprecated alias for older cached bundles.
 *
 * The default matches the server's: real name by default, with anonymity
 * available. A hub that has not set a policy gets the launch behaviour.
 */
export function useCommentIdentityMode(): CommentIdentityMode {
  const served = useHubSetting("moderation.comment_identity_mode");
  return (served as CommentIdentityMode | undefined) ?? "anonymous_optional";
}
