-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-project@0.1.1 passed the conformance suite (24471a1+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-project',
  '0.1.1',
  'sha256:76ad34599010162debd15a156c4a5f8568291caa64ccad1aa93c6e86e64ad804',
  'Projects',
  'project',
  'civic.project',
  '{"activities":{"emit":["civic.project.created","civic.project.updated","civic.project.sentiment_changed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["projects","project_sentiments","project_drafts","project_updates","project_comments"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-27T05:33:43.665Z","commit":"24471a1+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
