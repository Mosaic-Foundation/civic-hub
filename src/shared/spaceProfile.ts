// The kernel's roles and words, and the profile a space type names them in
// (docs/KERNEL.md §3, kernel step 2).
//
// The kernel knows four roles: member, moderator, admin, and accountable (a
// person who holds a public role and answers for it). It knows a few words
// every plugin may need: what a member is called, what an accountable person
// is called, and what the space is called. A profile names them for its field
// of work ("resident", "official", "hub" on a Civic Hub); it cannot add a role
// the kernel does not know. A word is added to the kernel only when two
// plugins need it ("group" and "outcome" are planned, not yet needed).
//
// A word resolves in this order: the space's own word (a setting), then the
// profile's word for the space's kind, then the profile's word, then the
// kernel's neutral word.
//
// Pure, shared by the server and the UI. Names no plugin and no space type:
// the profile itself lives with its space type (src/shared/profiles/).

/** The roles the kernel knows. A profile names these; it adds none. */
export const KERNEL_ROLES = ["member", "moderator", "admin", "accountable"] as const;
export type KernelRole = (typeof KERNEL_ROLES)[number];

/**
 * The names the hub used before the kernel had neutral ones, still read in a
 * process descriptor (`callers`, `publish_at_once`) through SDK v1. New code
 * writes the kernel's names.
 */
export const LEGACY_ROLE_NAMES = { resident: "member", official: "accountable" } as const satisfies Record<string, KernelRole>;
export type LegacyRoleName = keyof typeof LEGACY_ROLE_NAMES;

/** A role named either way, read as the kernel's role; any other name is returned as it is. */
export function kernelRoleOf(name: string): string {
  return (LEGACY_ROLE_NAMES as Record<string, string>)[name] ?? name;
}

/** Whether a list of role names (a descriptor's `callers`) includes this role, by either name. */
export function namesRole(names: readonly string[] | null | undefined, role: KernelRole | "creator" | "system"): boolean {
  return Boolean(names?.some((n) => kernelRoleOf(n) === role));
}

/** The words the kernel knows. */
export const KERNEL_TERMS = ["member", "accountable", "space"] as const;
export type KernelTerm = (typeof KERNEL_TERMS)[number];

/** The kernel's own word for each, when no profile names it. */
export const NEUTRAL_TERMS: Readonly<Record<KernelTerm, string>> = {
  member: "member",
  accountable: "office holder",
  space: "space",
};

/**
 * A profile's word: one word, or one per kind of space (the space's
 * `identity.hub_kind` setting), with "*" for any other kind.
 */
export type ProfileWord = string | Readonly<Record<string, string>>;

export interface SpaceProfile {
  /** "civic". */
  id: string;
  /** What a space of this type is called in running text, and its plural. */
  space: { one: string; many: string };
  /** The name of each kernel role, as an admin's pages show it. */
  roles: Readonly<Record<KernelRole, string>>;
  /** Its words for the kernel's terms; a term it leaves out reads the neutral word. */
  terms: Readonly<Partial<Record<KernelTerm, ProfileWord>>>;
}

/** "resident" → "residents", "family" → "families", "class" → "classes". */
export function pluralNoun(one: string): string {
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(one)) return `${one}es`;
  return `${one}s`;
}

/**
 * A kernel word, for `count` of them: the space's own word when it set one
 * (singular; the plural is formed from it), else the profile's for the
 * space's kind, else the profile's, else the neutral word. Lower case.
 */
export function resolveTerm(
  term: KernelTerm,
  profile: SpaceProfile | null,
  space: { kind?: string | null; own?: string | null } = {},
  count = 1,
): string {
  const own = space.own?.trim().toLowerCase();
  const one = own || profileWord(profile?.terms[term], space.kind) || NEUTRAL_TERMS[term];
  return count === 1 ? one : pluralNoun(one);
}

function profileWord(word: ProfileWord | undefined, kind: string | null | undefined): string | null {
  if (word === undefined) return null;
  if (typeof word === "string") return word;
  return (kind ? word[kind] : undefined) ?? word["*"] ?? null;
}

/** What a profile must hold: every kernel role named, and only the kernel's roles and terms. */
export function profileProblems(p: SpaceProfile): string[] {
  const out: string[] = [];
  for (const r of KERNEL_ROLES) if (!p.roles[r]?.trim()) out.push(`${p.id}: role ${r} has no name`);
  for (const r of Object.keys(p.roles)) if (!(KERNEL_ROLES as readonly string[]).includes(r)) out.push(`${p.id}: ${r} is not a kernel role`);
  for (const t of Object.keys(p.terms)) if (!(KERNEL_TERMS as readonly string[]).includes(t)) out.push(`${p.id}: ${t} is not a kernel term`);
  if (!p.space.one.trim() || !p.space.many.trim()) out.push(`${p.id}: the space has no name`);
  return out;
}
