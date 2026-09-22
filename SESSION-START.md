# SESSION-START.md — how every multi-tenant session begins

Paste the block below as the first message of each Claude Code session, then
fill in the three custom lines. One slice per session; start a fresh session
for the next slice.

---

You are working in `civic-hub/` inside the Civic-Social-Mono repo, on the
`multi-tenant` branch (create it from `main` if it does not exist; otherwise
`git pull` and merge `main` into it first).

Read, in this order, and nothing else until you need it:
1. `../CLAUDE.md` (project rules and session ritual)
2. `HANDOFF-INDEX.md` (do NOT read HANDOFF.md whole; open only the line ranges
   the index points you to, with `sed -n START,ENDp HANDOFF.md`)
3. `BUILD-PLAN-multi-tenant.md` (the contracts: `hubs` columns, settings key
   names, `forHub()` signature; the phase checklists)
4. `TESTING.md` "Quick Start" only

Context you already have: one codebase, today one Supabase database per hub.
We are converting to one deployment and one shared database with `hub_id` on
every table and database-enforced row-level security. Floyd is hub #1 and is
in beta. Production is NOT touched in any session until the cutover session,
which Adam runs by hand from a runbook.

Rules for this session:
- Additive migrations only: add columns with defaults, never rename or drop.
- Never import the raw Supabase client outside `src/db/` and the control plane.
- No string in `src/` or `ui/src/` may name a place; Floyd's values are data.
- Every slice ends with: tests green (`npm test`, and Playwright if UI changed),
  a short entry prepended to HANDOFF.md, and a commit on `multi-tenant`.
- If a decision is not covered by BUILD-PLAN-multi-tenant.md, stop and ask
  Adam before choosing. Do not guess at names of settings keys or columns.
- Delegate mechanical repeats (string sweeps, converting further modules to an
  established pattern, generating per-table policies from a template) to a
  Sonnet subagent; keep design, votes/receipts, RLS, and tests on the main model.

THIS SESSION
- Slice: <phase and task from the plan, e.g. "Phase 1: hubs table + resolver">
- Done when: <the check from the plan, e.g. "two hubs rows, two hostnames, same build">
- Notes from Adam: <anything decided in chat since the plan was written>

Begin by restating the slice in two sentences and listing the files you expect
to touch. Then work.
