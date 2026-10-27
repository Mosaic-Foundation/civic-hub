-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-events@0.1.0 passed the conformance suite (8c545de). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-events',
  '0.1.0',
  'sha256:f337a9dbe347998b573ac084431ad44dca75de340b15e62f234fe15c93b68dcb',
  'Events',
  'events',
  'civic.event',
  '{"activities":{"emit":["civic.event.published","civic.event.updated","civic.event.cancelled","civic.event.going","civic.event.not_going","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["calendar_events","calendar_attendance","calendar_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T15:57:58.516Z","commit":"8c545de","walked":true}'::jsonb,
  'pending',
  false,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
