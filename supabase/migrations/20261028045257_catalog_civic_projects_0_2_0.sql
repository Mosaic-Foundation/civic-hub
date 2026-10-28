-- A plugin catalog entry, written by `npm run catalog:add` (ADR-014). Additive.
-- @civic-social/plugin-project@0.2.0 passed the conformance suite (535f7f4+uncommitted). The row waits,
-- 'pending', for the operator to approve it in the console; until then the
-- loader does not mount this version on the deployment. The console signs it as
-- it approves it (ADR-015).
-- Marked required: once approved and running, every hub on an older version is moved to it.

INSERT INTO plugin_catalog (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, required, auto_install)
VALUES (
  '@civic-social/plugin-project',
  '0.2.0',
  'sha256:e52f9f11ac912fc27f3e0fc07ddf73140fceea82b4d3c01ee49dbd820425e91a',
  'Projects',
  'project',
  'civic.project',
  '{"activities":{"emit":["civic.project.created","civic.project.updated","civic.project.sentiment_changed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["projects","project_sentiments","project_drafts","project_updates","project_comments"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section"]}}'::jsonb,
  '{"result":"passed","ran_at":"2026-10-28T04:52:57.573Z","commit":"535f7f4+uncommitted","walked":true}'::jsonb,
  'pending',
  true,
  true
)
ON CONFLICT (package, version, hash) DO NOTHING;
