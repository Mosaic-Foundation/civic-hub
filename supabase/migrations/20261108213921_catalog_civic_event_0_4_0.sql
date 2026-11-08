-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-events@0.4.0 passed the conformance suite (09fe291). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-events',
  '0.4.0',
  'sha256:e7cc34ec49b5c472ffb0cdb7c7109d7650b1e482a114498c1c36f7b8ae59a46f',
  'Events',
  'events',
  'civic.event',
  '{"activities":{"emit":["civic.event.published","civic.event.updated","civic.event.cancelled","civic.event.going","civic.event.not_going","civic.event.announced","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["calendar_events","calendar_attendance","calendar_drafts","calendar_announcements"]},"adapters":["objectStore","mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-08T21:39:21.193Z","commit":"09fe291","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
