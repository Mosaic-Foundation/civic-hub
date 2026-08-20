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

/** This deployment's own place code, or null when it has no civic geography. */
export function civicPlaceCode(): string | null {
  return normalizePlaceCode(process.env.CIVIC_JURISDICTION ?? DEFAULT_JURISDICTION);
}

/**
 * Human-readable name for the place code, e.g. "Floyd County, Virginia".
 * Optional — when unset, serialized `location` objects carry only the code.
 */
export function civicPlaceName(): string | null {
  const name = process.env.CIVIC_JURISDICTION_NAME?.trim();
  return name ? name : null;
}

/** Display name of this space, used in `generator.name` and email surfaces. */
export function hubName(): string {
  return process.env.HUB_NAME?.trim() || "Floyd Civic Hub";
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
      throw new Error(
        "CIVIC_SPACE_DID must be set in production. It is this space's stable " +
          "identifier (`generator.id` on every emitted activity) and must not " +
          "be derived from BASE_URL, which changes when the deployment moves. " +
          "Set it once — e.g. did:web:floyd.civic.social — and never change it; " +
          "a new value reads to consumers as a different space.",
      );
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
        `e.g. did:web:floyd.civic.social.`,
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
