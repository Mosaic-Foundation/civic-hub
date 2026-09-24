// Hub identity + jurisdiction for whichever hub is serving the request.
//
// MULTI-TENANT NOTE (Phase 1). These used to be deployment-wide constants read
// from env. They now read the hub resolved by src/middleware/hub.ts, via the
// request-scoped accessor in ./hubContext.ts, and fall back to the env vars
// only when no request is in scope — crons, scripts, boot — or when a
// single-hub self-hosted deployment has no hubs row to find. The env vars stay
// documented in .env.example for exactly that case.
//
// Two exports are deliberately NOT request-scoped yet:
//   HUB_ID               the PROTOCOL identity stamped on published
//                        activities as source.hub_id. It is not hubs.id and
//                        must not be derived from it (BUILD-PLAN contract 1).
//   DEFAULT_JURISDICTION the event `jurisdiction` field. It becomes per-hub
//                        in Phase 2, together with the rest of event
//                        emission; converting it here alone would leave
//                        events half hub-scoped.
//
// Original note follows.
//
// Single source of truth for this deployment's hub identity + jurisdiction.
// Previously "civic-hub-local" / "local" were hardcoded in ~9 files, so prod
// Floyd events carried hub_id "civic-hub-local", and the discovery manifest
// read CIVIC_JURISDICTION while emitters ignored it (inconsistent provenance).
//
// Defaults are preserved, so nothing changes until the env vars are set. To
// stamp Floyd's real identity on new events, set on the prod deployment:
//   CIVIC_HUB_ID=civic-hub-floyd     (or your chosen id)
//   CIVIC_JURISDICTION=us-va-floyd
//   CIVIC_SPACE_DID=did:web:floyd.civic.social
import { baseUrl } from "../utils/baseUrl.js";
import { currentHub } from "./hubContext.js";

export const HUB_ID = process.env.CIVIC_HUB_ID ?? "civic-hub-local";
export const DEFAULT_JURISDICTION = process.env.CIVIC_JURISDICTION ?? "local";

/**
 * Values of CIVIC_JURISDICTION (and of an event's `jurisdiction` field) that
 * mean "this deployment has no civic geography". Civic Activity Spec v0.2
 * §2.2 is explicit that `location` is omitted entirely in that case — there
 * is no null sentinel and no `"none"` string on the wire. "local" is the
 * hub's historical dev default and is treated the same way.
 */
const NON_GEOGRAPHIC = new Set(["", "local", "none", "unknown"]);

/**
 * Normalize a jurisdiction string into a civic place code, or null when it
 * denotes no civic geography.
 *
 * A civic place code (Civic Activity Spec v0.2 §2.2.2) is lowercase,
 * hyphen-separated, and hierarchical broadest-to-narrowest:
 *   us · us-va · us-va-floyd · us-va-floyd-ward3
 * Consumers filter on it with containment semantics, so organization or
 * community names MUST NOT be encoded here.
 */
export function normalizePlaceCode(
  jurisdiction: string | null | undefined,
): string | null {
  const trimmed = (jurisdiction ?? "").trim().toLowerCase();
  if (NON_GEOGRAPHIC.has(trimmed)) return null;
  return trimmed;
}

/**
 * The serving hub's place code, or null when it has no civic geography.
 *
 * Reads the hub resolved for the request in flight. Falls back to the env var
 * when there is no request in scope — crons, scripts, boot — which is also
 * what keeps a single-hub self-hosted deployment working unchanged.
 */
export function civicPlaceCode(): string | null {
  const hub = currentHub();
  if (hub) return normalizePlaceCode(hub.jurisdiction_code);
  return normalizePlaceCode(process.env.CIVIC_JURISDICTION ?? DEFAULT_JURISDICTION);
}

/**
 * Human-readable name for the place code, e.g. "Floyd County, Virginia".
 * Optional — when unset, serialized `location` objects carry only the code.
 */
export function civicPlaceName(): string | null {
  const hub = currentHub();
  if (hub) {
    const fromHub = hub.jurisdiction_name?.trim();
    return fromHub ? fromHub : null;
  }
  const name = process.env.CIVIC_JURISDICTION_NAME?.trim();
  return name ? name : null;
}

/**
 * The place itself, without its state: "Floyd County" from "Floyd County,
 * Virginia". Null when the hub has no civic geography.
 *
 * The same first-segment derivation the legal documents use for `{PLACE}`
 * (src/services/hubDocuments.ts) and the UI uses for `hub.place`, so a
 * sentence a plugin writes and a sentence a document writes name the place
 * the same way.
 */
export function civicPlaceShortName(): string | null {
  const place = civicPlaceName()?.split(",")[0]?.trim();
  return place ? place : null;
}

/**
 * The jurisdiction a plugin stamps on a process it creates for this hub, or
 * undefined to let processService apply its default. A place code from the
 * hubs row when there is one — never a literal, which is how every synced
 * announcement on every hub would have been filed under one county.
 */
export function processJurisdiction(): string | undefined {
  return civicPlaceCode() ?? undefined;
}

/** Display name of this space, used in `generator.name` and email surfaces. */
export function hubName(): string {
  const hub = currentHub();
  if (hub) return hub.name;
  return process.env.HUB_NAME?.trim() || "Civic Hub";
}

/**
 * The space's stable identifier — the key consumers bind provenance to.
 * Unlike the serving URL it survives migration (Civic Activity Spec §3.3),
 * so it is `generator.id` on every emitted activity and `space.id` in the
 * discovery manifest.
 *
 * Defaults to a `did:web:` derived from the API base URL host, which is a
 * real, resolvable-in-principle identifier for any deployment that serves
 * `/.well-known/did.json` — good enough for dev, and overridable in prod
 * with CIVIC_SPACE_DID once the space's DID is minted.
 */
export function spaceDid(): string {
  const hub = currentHub();
  if (hub) return hub.space_did;
  const configured = process.env.CIVIC_SPACE_DID?.trim();
  if (configured) return configured;
  return deriveDidWeb(baseUrl());
}

/**
 * Boot-time guard: production MUST name its space DID explicitly.
 *
 * The derived `did:web:` fallback is correct for dev and preview, but in
 * production it makes the space's stable identifier a function of BASE_URL —
 * so moving hosts, changing domains, or fronting the API differently would
 * silently mint a NEW identity. `generator.id` is the key consumers bind
 * provenance to and the one value that is supposed to survive exactly those
 * moves (Civic Activity Spec §2.2, §3.3). A silently-changing DID reads to
 * every consumer as a different space, and no migration activity was emitted.
 *
 * Mirrors the CIVIC_ALLOWED_ORIGINS convention in app.ts: unset in production
 * is a hard failure at boot, not a surprise at request time.
 *
 * @throws in production when CIVIC_SPACE_DID is unset or malformed.
 */
export function assertSpaceIdentityConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const configured = env.CIVIC_SPACE_DID?.trim();
  const isProd = env.NODE_ENV === "production";

  if (!configured) {
    if (isProd) {
      // NO LONGER FATAL (2026-09-22). Every hub carries its own `space_did`,
      // NOT NULL on the `hubs` row, and that is what is stamped on activities
      // — so the identity this assertion protects is guaranteed by the
      // database rather than by an environment variable. With one deployment
      // serving many hubs, a single CIVIC_SPACE_DID could not be correct for
      // all of them anyway; refusing to boot without one would block every
      // multi-hub deployment for the sake of a value nothing reads.
      //
      // The warning stays: an env var that is set but ignored is worth
      // knowing about, and a deployment with no hubs rows at all still falls
      // back to it.
      console.warn(
        "[config] CIVIC_SPACE_DID is unset. Each hub's space_did comes from " +
          "its `hubs` row, so this is expected on a multi-hub deployment. It " +
          "is used only as a fallback when no hub is in scope.",
      );
      return;
    }
    console.warn(
      `[config] CIVIC_SPACE_DID is unset — deriving "${deriveDidWeb(baseUrl())}" ` +
        `from BASE_URL. Fine for dev; production refuses to start without it.`,
    );
    return;
  }

  if (!/^did:[a-z0-9]+:.+/.test(configured)) {
    throw new Error(
      `CIVIC_SPACE_DID="${configured}" is not a DID. Expected did:<method>:<id>, ` +
        `e.g. did:web:example.civic.social.`,
    );
  }
}

/**
 * did:web derivation per the did:web method spec: the host is the method
 * identifier, and a port is percent-encoded (`localhost%3A3000`).
 */
function deriveDidWeb(url: string): string {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = "localhost";
  }
  return `did:web:${host.replace(":", "%3A")}`;
}
