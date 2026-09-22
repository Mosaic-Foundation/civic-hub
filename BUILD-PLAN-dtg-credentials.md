# Plan: DTG-aligned credentials for the Civic Hub (the OpenVTC "easy route")

**Status:** Planned, not scheduled. Nothing here is built and no specification has been changed. This plan records *how* the Floyd Civic Hub would implement the low-cost, standards-only parts of Open Verifiable Trust Communities when the time comes, so the decision can be made with the work already scoped.
**Date:** 2026-08-27
**Basis:** `civic-social-docs/ecosystem/openvtc-alignment-audit.md` (the exploratory audit; read §3.1–3.3 and §3.8 first). This plan implements audit options 3.1, 3.2 (minimal form), 3.3, and 3.8. It deliberately does **not** implement 3.5 (VRCs), 3.6 (VTA custody), or 3.7 (civic VTN).

---

## Context

The Floyd Civic Hub runs on stub identity today, exactly as the Civic Space Specification §3.1 / §7.3 and Civic Identity Specification §12.4 permit during early phases:

- Login is email OTP → session token (`civic-hub/src/modules/civic.auth`). `users.id` is opaque text; the code comments already say "replaceable with a DID later."
- Residency is a self-affirmation (`users.is_resident`), not a verified credential.
- Roles are not data: admin and board membership are env-var email lists (`CIVIC_ADMIN_EMAILS`, `CIVIC_BOARD_EMAILS`), resolved in `middleware/auth.ts` (`isAdminEmail`, `resolveAuthorship`).
- The space DID (`CIVIC_SPACE_DID`, e.g. `did:web:floyd.civic.social`) is stamped on the manifest and on activities, but no DID document is published, so it does not resolve.
- Nothing is issued and nothing is verified. `actor` on activities is the user id (the model type says `userId or DID`).

The OpenVTC/DTG work (ToIP `dtgwg-cred-spec`, First Person Project, Affinidi VTI) defines W3C VC types for community membership (**VMC** — `MembershipCredential`), endorsements and roles (**VEC** — `EndorsementCredential`), and a governance-based definition of a personhood credential (**PHC** — a VMC from a community whose published governance enforces one real human per membership). Adopting those *types* costs a `type` array and an `@context`; it does not require their transport (DIDComm, Trust Tasks) or their Rust daemons. That is the easy route.

**What the resident sees change: nothing.** OTP login stays. Credentials are issued behind the scenes into hub-managed custody — the "managed key custody by default" model Identity §9.1 and §10 already describe for the first deployment.

## Locked assumptions (revisit if any is wrong)

- The hub remains the resident's Citizen Account Provider for now: it mints and holds member keys. Self-custody / external wallets are a later phase, reached through the same adapter seam.
- Wallet-facing protocol stays OpenID4VP / SIOPv2 as specified. This plan adds no DIDComm.
- Credentials are secured with **W3C Data Integrity** (the DTG world's format) for the DTG-typed credentials the hub issues. SD-JWT VC remains the Identity §7.1 floor for residency and other selectively-disclosed credentials; this plan does not issue those.
- One hub key, held in the deployment's secrets, is the Community Node's "designated custodian" arrangement (Identity §5.3). A VTA or multisig is a later upgrade that does not change anything issued under this plan (same DID, rotated keys).

## Non-goals

DIDComm, Trust Tasks, running any part of Affinidi's VTI, Verifiable Relationship Credentials, zero-knowledge presentations, a wallet UI, cross-hub recognition, a TRQP server, changing the login flow, changing what `is_resident` means without real vetting behind it.

## Spec anchors

`civic-social-docs/specs/civic-identity-spec.md` §2 (Citizen Node), §5.1 (Space DIDs), §5.3 (key control), §7.1 (formats), §7.2 (credential registry), §7.5 (revocation via Bitstring Status List), §9.1–9.2 (provider and issuer roles), §10 (managed custody), §12.4 (phasing) · `specs/civic-space-spec.md` §3.5 (space DID), §4.5 (Membership), §7.2.0 (manifest; consumers ignore unknown fields), §7.3 (identity adapter) · `ecosystem/authorization-model-note.md` (single seam; authority as claims not role strings) · `ecosystem/openvtc-alignment-audit.md` §3 · DTG Core Credentials spec (`trustoverip/dtgwg-cred-spec`) — Base Structure, VMC, VEC, "Supporting Concepts → Personhood Credentials".

---

## Slices

Sized at roughly one Fable prompt each, ordered by dependency. Each slice is independently shippable and leaves the hub working.

### S0 — Decision record and dependencies

Add `decisions/004-dtg-credential-alignment.md` (ADR): the hub issues DTG-typed VCs secured with Data Integrity; member keys are hub-custodied `did:key`; roles become data. Log the new dependencies per the harness rule (check `decisions/` before adding dependencies): the Digital Bazaar `@digitalbazaar/*` suite — `vc`, `data-integrity`, the `eddsa-rdfc-2022` and/or `eddsa-jcs-2022` cryptosuite, `ed25519-multikey`, `vc-bitstring-status-list` — plus `did:key` and `did:web` resolution. Pick **one** cryptosuite to *issue* with (recommend `eddsa-rdfc-2022`, the one Identity §7.1 already names) and verify **both**. Effort: half a day.

### S1 — Publish the hub's DID document

Serve `GET /.well-known/did.json` for `CIVIC_SPACE_DID`: a DID Core 1.0 document with one Ed25519 `Multikey` verification method used for `assertionMethod` and `authentication`, and a `service` entry pointing at the hub's base URL (Space §3.5 "serving URL is a current binding"). Private key from a new secret (`CIVIC_HUB_SIGNING_KEY`, multibase). Add a `scripts/gen-hub-key.ts` that prints a fresh keypair. Acceptance: a standard `did:web` resolver returns the document; the public key in it verifies a signature made with the secret. Effort: one day.

### S2 — Member DIDs

Migration: `users.did TEXT UNIQUE`, `users.key_material` (encrypted at rest — see risk R2). On account creation (and lazily for existing users at next login) mint a `did:key` per user and store it. Change activity emission so `actor` is the member's DID when present (the Activity model already allows it; keep the user id as a fallback for pre-migration rows). Because the hub mints the DID, it is per-hub by construction — this satisfies the DTG's "M-DID per community" rule without any extra work. Acceptance: new activities carry `did:key:…` actors; existing tests pass; `/events` consumers (Dashboard, Rep Space feed classifier) are unaffected. Effort: two to three days.

### S3 — Issue the Membership Credential (VMC)

New module `src/modules/civic.credentials` and table `credentials (id, type, subject_did, issuer_did, status_index, valid_from, valid_until, revoked_at, document JSONB)`. On residency affirmation (or on verified email — decide in S0), issue:

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2",
               "https://firstperson.network/credentials/dtg/v1",
               "https://civic.social/ns/civic"],
  "type": ["VerifiableCredential", "DTGCredential", "MembershipCredential"],
  "issuer": "<hub DID>",
  "validFrom": "...", "validUntil": "<+90d>",
  "credentialSubject": { "id": "<member did:key>",
                         "membership": { "community": "<hub DID>", "joinedAt": "...", "role": "member" } },
  "credentialStatus": { "type": "BitstringStatusListEntry", "statusPurpose": "revocation",
                        "statusListIndex": "<n>", "statusListCredential": "<hub>/status-lists/revocation" },
  "proof": { "type": "DataIntegrityProof", "cryptosuite": "eddsa-rdfc-2022", "..." : "..." }
}
```

Publish `GET /status-lists/revocation` (a `BitstringStatusListCredential` signed by the hub; reserve indexes 0–3 as decoys so the first member is not visibly index 0 — the VTI convention). Serve the member's own credentials at `GET /me/credentials` (requireAuth). Renewal: re-issue on login when within 14 days of `validUntil`, same status index. Revocation: flip the bit on account deletion or admin removal. Acceptance: the issued VC verifies with an independent verifier (a small script using the same library against the published DID document and status list); revoking flips the bit and the verifier reports revoked. Effort: one week including tests and migration.

### S4 — Roles as data, issued as VECs

Migration: `roles (user_id, role, granted_by, granted_at, revoked_at)`. Seed from the existing env email lists on first boot; keep the env lists as a read-only fallback for one release, then remove. `resolveAuthorship()` and `isAdminEmail()` read the table. For each active role issue a `["VerifiableCredential","DTGCredential","EndorsementCredential"]` with `credentialSubject.endorsement = { type: "CommunityRole", role: "admin|board|moderator", communityDid: "<hub DID>" }`, revocable via the same status list. Admin UI: a small roles panel. Acceptance: admin gating behaves identically before and after; a board member's VEC verifies. This slice is worth doing on its own merits — roles as config strands the authorization layer on migration (Identity §11.1). Effort: three to four days.

### S5 — Personhood governance, declared honestly

Add a `personhood` block to the discovery manifest (unknown fields are ignored by spec) and to a new `GET /community/profile`:

```json
"personhood": { "realHuman": false, "singleMembership": false,
                "acceptedIdvps": [], "governanceFrameworkUrl": "<hub>/governance" }
```

Both booleans **start `false`**: `is_resident` is a self-affirmation and the DTG rule is that a community asserts nothing it does not enforce. Then add the admin action **"Verified in person"**: issues an `IdentityVerification` endorsement VEC (`claim: { method: "in-person", verifiedBy: "<admin DID>" }`) to the member's DID and stamps `personhood: true` on a re-issued VMC (optionally adding the non-authoritative `"PersonhoodCredential"` type hint per the DTG spec). Once that exists and `governance.md` is written, set `realHuman: true`, `acceptedIdvps: ["<hub DID>"]`. `singleMembership` stays `false` until a per-person deduplication anchor exists (email uniqueness is not one). Acceptance: manifest and profile serve the block; the vetting action produces a verifiable endorsement; the declaration matches what is enforced. Effort: two to three days.

### S6 — Verifier in the identity adapter

`src/identity/verifyCredential.ts`: given a VC or VP, resolve the issuer DID (`did:web`, `did:key`), verify the Data Integrity proof (both cryptosuites), check the validity window, fetch and check the status-list bit, and check the issuer against a trust list. Wire it behind the existing adapter so that an Identity Policy Object requirement (`organizational_membership`, `civic_role.*`, `proof_of_personhood`) can be satisfied by a presented credential — initially exercised only by tests against the hub's own credentials. Acceptance: a `civic.vote` descriptor requiring `organizational_membership` admits a holder of a valid VMC and rejects a revoked one. Effort: three to four days.

### S7 — Trust list, minimal

`config/trust-registry.json`: `{ "<credential type>": ["<issuer DID>", …] }`, initially just the hub itself. Read by S6. This is the Identity §9.2 "trust registry entry" in its smallest form; querying a ToIP TRQP registry replaces the file when a second issuer exists. Effort: half a day.

**Total:** roughly three to four weeks of focused build, one migration set (S2, S3, S4), no runtime dependency on any OpenVTC code.

---

## Specification edits — deferred until S3 verifies end-to-end

These are the changes the audit identified. They are intentionally **not** made now; make them in one pass once the hub has issued and verified a real VMC, so the spec text describes something that works.

- **Civic Identity §7.2** — membership and civic-role credentials are profiles of DTG `MembershipCredential` and `EndorsementCredential`; `proof_of_personhood` MAY be satisfied by a PHC from a recognized personhood community (First Person Network) or by the hub's own published personhood governance.
- **Civic Identity §7.1** — verifiers MUST accept Data Integrity proofs (`eddsa-rdfc-2022`, `eddsa-jcs-2022`) for DTG-typed credentials; SD-JWT VC remains the floor for residency and other selectively-disclosed credentials.
- **Civic Identity §9.2 / §13** — name TRQP v2.0 as the trust-registry target; adopt the M-DID / R-DID / P-DID vocabulary in the pairwise-DID open question.
- **Civic Space §4.5** (optional) — note that Membership MAY be materialized as a VMC; **§7.2.0** (optional) — document the `personhood` manifest block.
- **Civic Credentialing pilot §11** — schemas defined as DTG profiles; the mutual-consent display model unchanged.
- **Terminology** — add VMC, VEC, PHC, DTG, TRQP.

---

## Verification

- Unit: signing and verifying round-trips for VMC and VEC; status-list flip; renewal keeps the index; revoked credential fails verification.
- Independent verifier: a standalone script (no hub imports) that fetches `/.well-known/did.json`, `/status-lists/revocation`, and a credential, and verifies with the library alone. This is the "any conformant verifier can check it" claim made real.
- Regression: full existing suite; Dashboard and Rep Space feed consumers unaffected by DID actors.
- Honesty check: the manifest's `personhood` booleans equal what the code enforces (a test reads both).

## Risks

- **R1 — Overclaiming personhood.** Mitigated by S5's "start false" rule and the honesty test.
- **R2 — Hub-custodied member keys.** The hub can sign as its members. Acceptable under Identity §10's transitional model, but it must be stated in the hub's privacy text, keys must be encrypted at rest with a separate secret, and export must exist before any external verifier relies on these DIDs.
- **R3 — DTG spec drift.** `dtgwg-cred-spec` is a Working Draft. Pin the context URL and type strings in one constants file; do not hard-code Trust Task URIs anywhere.
- **R4 — Format split.** Issuing Data Integrity here while Identity §7.1 mandates SD-JWT VC creates two formats in the ecosystem. Contained by scope (DTG-typed credentials only) and closed by the deferred §7.1 edit.
- **R5 — `did:web` hosting on Vercel.** Static JSON at a `.well-known` path is straightforward, but confirm the production domain serves it at the apex used in `CIVIC_SPACE_DID` (the same class of DNS issue Horizons notes for the JSON-LD context).

## Fable handoff notes

- Read `CLAUDE.md`, `civic-hub/HANDOFF.md`, and `civic-social-docs/ecosystem/openvtc-alignment-audit.md` §3 first.
- Do not bypass the process registry, the single emission path (`emitEvent`), or the auth middleware; all new gates go through `middleware/auth.ts` and the identity adapter.
- New tables need RLS like every other table (see `20260704010000_rls_gap_tables.sql`).
- Keep every DTG constant (`@context` URL, type strings, endorsement type URIs) in one file: `src/modules/civic.credentials/constants.ts`.
- Each slice ends with the independent-verifier script passing.
