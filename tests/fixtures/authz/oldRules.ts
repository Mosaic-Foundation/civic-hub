// The authorization rules as they were before the seam (a104260), frozen, for
// tests/api/authzParity.test.ts (Architecture 4, ADR-011).
//
// Every rule here decided by EMAIL ADDRESS against the hub's people lists, as
// src/middleware/auth.ts, src/controllers/processController.ts and
// src/services/processService.ts did at a104260. The parity test asks these
// and the seam the same questions and requires the same answers. Kept until
// the lists stop being the input to hub_roles (Adam, Q5); then delete this
// file and the test together. Do not "fix" anything here: it is the record of
// what the old code did, including its order of refusals.

/** The settings one hub had, as stored (key → raw value). */
export type Settings = Readonly<Record<string, string>>;

export interface OldUser {
  id: string;
  email: string;
  is_resident: boolean;
  full_name: string | null;
}

export interface OldOfficial {
  type: string;
  title: string;
}

/** What one old check answered: allowed, or the error code it threw. */
export type OldAnswer =
  | { allowed: true; caller?: "admin" | "resident"; authorship?: OldAuthorship | null; official?: OldOfficial | null }
  | { allowed: false; code: string };

export interface OldAuthorship {
  isAdmin: boolean;
  official: OldOfficial | null;
  role: "admin" | "author";
  label: string;
  name: string | null;
}

// --- reading the lists (services/hubSettings.ts, models/hubSettings.ts) -------

const ALIASES: Record<string, string> = { "people.announcement_authors": "announcement_authors" };

/** resolve(map, key) for a people key inside a hub: the row, its alias, else nothing (never env). */
function resolve(settings: Settings, key: string): string | undefined {
  const direct = settings[key];
  if (direct !== undefined && direct !== "") return direct;
  const alias = ALIASES[key];
  if (alias) {
    const a = settings[alias];
    if (a !== undefined && a !== "") return a;
  }
  return undefined;
}

function asList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v.length > 0);
      }
    } catch {
      // a corrupt row reads as a comma list
    }
  }
  return trimmed.split(",").map((v) => v.trim()).filter((v) => v.length > 0);
}

function asEmailList(value: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of asList(value)) {
    const lower = entry.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

interface Author {
  email: string;
  name?: string;
  label: string;
}

function normalizeAuthors(raw: unknown[]): Author[] {
  const seen = new Set<string>();
  const out: Author[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { email?: unknown; name?: unknown; label?: unknown };
    const email = typeof e.email === "string" ? e.email.trim() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (!email || !label) continue;
    const lower = email.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(name ? { email, name, label } : { email, label });
  }
  return out;
}

function getAnnouncementAuthors(settings: Settings): Author[] {
  const stored = resolve(settings, "people.announcement_authors");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.every((e) => typeof e === "object")) return normalizeAuthors(parsed);
    } catch {
      // A corrupt row must not lock out board members who posted yesterday.
    }
  }
  const board = resolve(settings, "people.board_emails");
  return normalizeAuthors(asList(board).map((email) => ({ email, label: "Board member" })));
}

function lookupAuthor(settings: Settings, email: string | null | undefined): Author | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  for (const a of getAnnouncementAuthors(settings)) if (a.email.toLowerCase() === lower) return a;
  return null;
}

// --- the checks (middleware/auth.ts at a104260) -----------------------------

export function isAdminEmail(settings: Settings, email: string | null | undefined): boolean {
  if (!email) return false;
  return new Set(asEmailList(resolve(settings, "people.admin_emails"))).has(email.toLowerCase());
}

const OFFICE_TYPES: Array<[RegExp, string]> = [
  [/supervisor|board/i, "board_of_supervisors"],
  [/council/i, "town_council"],
  [/planning/i, "planning_commission"],
  [/school/i, "school_board"],
];

/**
 * resolveOfficialParts(email): the managed role (a users row found BY EMAIL),
 * else the legacy list until migrated. `inferType` is the app's own
 * inferOfficialType, passed in so the fixture does not freeze a copy of a
 * function this slice did not touch.
 */
function officialParts(
  settings: Settings,
  email: string | null | undefined,
  managedByEmail: OldOfficial | null,
  inferType: (label: string) => string,
): { official: OldOfficial | null; legacy: Author | null } {
  if (!email) return { official: null, legacy: null };
  const migrated = resolve(settings, "people.officials_migrated") === "true" || settings["officials_migrated"] === "true";
  const legacy = lookupAuthor(settings, email);
  if (managedByEmail) return { official: managedByEmail, legacy: null };
  if (migrated || !legacy) return { official: null, legacy: null };
  return { official: { type: inferType(legacy.label), title: legacy.label }, legacy };
}
void OFFICE_TYPES;

export function resolveAuthorship(
  settings: Settings,
  email: string | null | undefined,
  managedByEmail: OldOfficial | null,
  inferType: (label: string) => string,
): OldAuthorship | null {
  if (!email) return null;
  const isAdmin = isAdminEmail(settings, email);
  const { official, legacy } = officialParts(settings, email, managedByEmail, inferType);
  if (!isAdmin && !official) return null;
  const legacyName = official && !isAdmin ? legacy?.name ?? null : null;
  return { isAdmin, official, role: isAdmin ? "admin" : "author", label: official?.title ?? "Admin", name: legacyName };
}

/** The guards, each after a valid session (sessionUser) for `user`. */
export function requireResident(user: OldUser): OldAnswer {
  if (!user.is_resident) return { allowed: false, code: "residency_required" };
  if (!user.full_name) return { allowed: false, code: "name_required" };
  return { allowed: true };
}

export function requireAdmin(settings: Settings, user: OldUser, assurance: "code" | "demo"): OldAnswer {
  if (assurance !== "code") return { allowed: false, code: "code_sign_in_required" };
  const allowed = new Set(asEmailList(resolve(settings, "people.admin_emails")));
  if (allowed.size === 0) return { allowed: false, code: "no_admins" };
  if (!allowed.has(user.email.toLowerCase())) return { allowed: false, code: "admin_required" };
  return { allowed: true };
}

export function requireAnnouncementPoster(
  settings: Settings,
  user: OldUser,
  assurance: "code" | "demo",
  managedByEmail: OldOfficial | null,
  inferType: (label: string) => string,
): OldAnswer {
  if (assurance !== "code") return { allowed: false, code: "code_sign_in_required" };
  const authorship = resolveAuthorship(settings, user.email, managedByEmail, inferType);
  if (!authorship) return { allowed: false, code: "author_required" };
  return { allowed: true, authorship };
}

export function requireOfficial(
  settings: Settings,
  user: OldUser,
  assurance: "code" | "demo",
  managedByEmail: OldOfficial | null,
  inferType: (label: string) => string,
): OldAnswer {
  if (assurance !== "code") return { allowed: false, code: "code_sign_in_required" };
  const { official } = officialParts(settings, user.email, managedByEmail, inferType);
  if (!official) return { allowed: false, code: "official_required" };
  return { allowed: true, official };
}

/** actOnProcess's caller (processController.ts at a104260): admin by email, else resident. */
export function actOnProcessCaller(settings: Settings, user: OldUser): "admin" | "resident" {
  return isAdminEmail(settings, user.email) ? "admin" : "resident";
}

/** residentMayCall (processService.ts at a104260), applied when the caller is "resident". */
export function residentMayCall(
  declared: { callers: readonly string[] } | undefined,
  createdBy: string,
  actor: string,
): boolean {
  if (!declared) return false;
  if (declared.callers.includes("resident")) return true;
  return declared.callers.includes("creator") && actor !== "" && actor === createdBy;
}
