-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-project@0.3.0 passed the conformance suite (ca2c009+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-project',
  '0.3.0',
  'sha256:1f7c1cf7ef152f062f54e899221c1aaab31f232bb258d8dce09dab4fe042d13f',
  'Projects',
  'project',
  'civic.project',
  '{"activities":{"emit":["civic.project.created","civic.project.updated","civic.project.sentiment_changed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["projects","project_sentiments","project_drafts","project_updates","project_comments"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-11-17T03:36:49.872Z","commit":"ca2c009+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
