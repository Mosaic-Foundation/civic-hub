# HANDOFF-INDEX.md — read this, not HANDOFF.md

HANDOFF.md is the full build log: 178 dated entries, newest first, ~11,300 lines.
Reading it whole costs most of a session's context. Use this index to find the
entry you need, then read only that line range (`sed -n START,ENDp HANDOFF.md`).
Line numbers are as of 2026-09-22; new entries are prepended at the top, so add
the length of anything newer than "Brief: prominent response button" (line 7) to
the numbers below, or just grep the heading.

## Where things are

| Need | File |
|---|---|
| Project rules, folder map, session ritual | `../CLAUDE.md` |
| Test commands, coverage, CI notes | `TESTING.md` |
| Config: every env var, with comments | `.env.example`, `ui/.env.example` |
| Hub identity and jurisdiction constants | `src/config/hub.ts` |
| Runtime settings read/write (`hub_settings`) | `src/services/hubSettings.ts` |
| Auth, sessions, admin/board resolution | `src/middleware/auth.ts`, `src/modules/civic.auth/` |
| Process registry and per-type handlers | `src/processes/registry.ts`, `src/processes/*Process.ts` |
| DB client (service role, the thing tenancy replaces) | `src/db/client.ts` |
| Migrations (47 files, 30 tables) | `supabase/migrations/` |
| Cron routes | `vercel.json` "crons" + `src/app.ts` `/internal/*` |
| Ideas backlog incl. multi-tenancy section | `IDEAS.md` (lines ~137–240) |
| Future plans | `BUILD-PLAN-*.md` |

## HANDOFF.md by topic (line ranges)

### Architecture and conventions you must not break
- What a new process type gets for free, and what it must declare — 3013–3047
- Approval activates through the registry, never fails silently — 1579–1655
- One card for every process list — 1656–1711
- Process unification Parts A/B/C — 7316–7360; one deadline-close + lifecycle — 7284–7315
- Shared feed-worthiness classifier (feed ↔ digest parity) — 7246–7283
- AS2 wire conversion, Civic Activity Spec v0.2 — 6594–6843
- Spec audit; hub namespace resolves — 2010–2064
- Schema drift check (why the 08-22 outage can't recur) — 5666–5760
- Pluggable voting methods + approval voting — 7420–7484

### Security, identity, anonymity
- Launch-critical security hardening (audit punch-list) — 6961–7045
- Identity & anonymity: ballot secrecy, real names, opt-in anonymous comments — 7046–7092
- Public anonymity: names hidden from signed-out viewers — 3584–3719
- Read paths stop trusting `?actor=` — 5838–5883
- Polis JWT auth — 7206–7245; Polis leaked token / wedged conversation — 1740–1831

### Config, settings, per-hub things (most relevant to multi-tenancy)
- Multi-deployment + demo-hub.civic.social launch, and the "Multi-tenant SaaS path" note — 8384–8616 (note at ~8602)
- Officials: admin-managed role with structured title — 4586–4749
- Admin-editable announcement authors — 10059–10148; brief recipients — 10333–10368
- Settings tab (admin IA) — 10015–10058; Admin Settings one section — 381–411
- Endorsement threshold wired to Admin Settings — 727–770
- Beta gating + digest frequency — 7719–7771; beta banners, landing, welcome dialog — 3416–3583
- Waitlist (opt-in, name, outage) — 5761–5837, 5956–6064
- Legal docs + minimal moderation — 9069–9218; legal-page dialog gate — 3416–3460
- Onboarding copy — 7093–7125; Welcome page — 8208–8253

### Plugins / process types (each has Floyd-specific config to move)
- Meeting summaries: silent discovery failure + connector ladder — 6065–6593; original slice — 9658–9846
- Floyd news auto-sync — 8725–8897
- Daily email digest — 9847–10014; admin digest / feedback in digest — 4750–4898
- Board announcements — 10149–10246; publication receipts — 4511–4585
- Civic Brief generation + approval — 10369–10519; official responses — 4384–4510; brief delivery via Resend — 354–380
- Projects module — 7772–7893; project editing/history — 2585–2771; comments on shared module — 489–556
- Proposals: AI-augmented process — 8115–8207; commenting — 8344–8383
- Votes: vote module — 7955–8033; auto-close — 7701–7718; change vote while open — 8294–8343
- Word cloud — 7631–7700, 7598–7630, 7582–7597; density measured — 1949–2009
- Conversations (Polis) join the flow — 3847–3929; sources + seed statements — 3793–3846
- Assistant (all process types): one creation flow — 3930–4049; tool-call validation — 1074–1121; suggestion cards — 1122–1185
- Search — 9219–9264; Feedback — 8665–8724, 107–146; Share — 8617–8664, 1509–1578
- Light process-linking — 5002–5665

### Operations
- SHIPPED to production — 3720–3735; Production readiness — 10752–10848
- Vercel builds: npm ci — 2772–2804
- Test infrastructure + cron route fix — 8254–8293
- Beta demo content slate seeded on PROD — 3262–3415
- Session close, beta smoke test day 1 — 2536–2569

### Reference sections at the bottom (older, partly stale)
- Component status snapshot — 10849–11141
- Proposal → vote pipeline — 11142–11186
- Authentication & participation gating — 11187–11218
- Assumptions, open questions, suggested next tasks — 11237–11304

### Everything else
Lines 7–2535 are UI polish and fixes from 2026-09-04 to 09-08, one entry each.
Grep the heading text if a session touches that surface.
