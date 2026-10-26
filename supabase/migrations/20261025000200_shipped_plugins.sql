-- The plugin packages the hub ships with, pre-approved, and installed on every
-- existing hub (plugin session 1, ADR-014). Written by scripts/catalog-shipped.ts
-- from b2fa4a0. Additive and idempotent.
--
-- Each row records the content hash of the package's files as shipped; the
-- loader mounts a package only when an approved row records its hash, so a
-- later change to a package is a new entry (npm run catalog:add) that the
-- operator approves in the console.

INSERT INTO plugin_catalog
  (package, version, hash, display_name, plugin, process_type, capabilities, conformance, status, approved_by, approved_at, notes)
VALUES
  ('@civic-social/plugin-vote', '0.1.0', 'sha256:170127036cbb24990332cb4a0ef6389531569304638484ec3a6dba8477c0b223', 'Votes', 'vote', 'civic.vote',
   '{"activities":{"emit":["civic.process.proposed","civic.process.threshold_met","civic.process.started","civic.process.vote_submitted","civic.process.ended","civic.process.aggregation_completed","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["vote_records","vote_participation","active_vote_keys","vote_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":true}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-proposal', '0.1.0', 'sha256:bf223761d765f39c9baa036e0b51a1bb402ba9525e373423d72cf1a1ef0ab553', 'Proposals', 'proposal', 'civic.proposal',
   '{"activities":{"emit":["civic.proposal.submitted","civic.proposal.supported","civic.proposal.support_withdrawn","civic.proposal.closed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["proposals","proposal_supports","proposal_drafts"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":true}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-project', '0.1.0', 'sha256:5c579887fd0ce99c59c8c85f6dd984d16107e38345835a7ab4d02857e499edde', 'Projects', 'project', 'civic.project',
   '{"activities":{"emit":["civic.project.created","civic.project.updated","civic.project.sentiment_changed"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["projects","project_sentiments","project_drafts","project_updates","project_comments"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":true}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-vote-results', '0.1.0', 'sha256:1143b2c86fdb26bc751dca69ec810f388c5051e1842eed40d619a51b0ff0d9ec', 'Vote results', 'vote', 'civic.vote_results',
   '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":false}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-brief', '0.1.0', 'sha256:105d92c5b142ae0d9f763e0c2093c9745adf6a9b05e61e5a428f7d694eab6621', 'Briefs', 'brief', 'civic.brief',
   '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published","civic.process.action_taken"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["brief_responses"]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":false}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-announcement', '0.1.0', 'sha256:7f9ebf249572be19732a57bdb3f08dd1100b88574214945a32d070a7c3dc68eb', 'Announcements', 'announcement', 'civic.announcement',
   '{"activities":{"emit":["civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["mail"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":true}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-meeting-summary', '0.1.0', 'sha256:478771c5c4f74acfb36d53f4aa44d1a23a0897696eff2cab0e9c8bf745ebfeda', 'Meeting summaries', 'meeting_summary', 'civic.meeting_summary',
   '{"activities":{"emit":["civic.process.aggregation_completed","civic.process.outcome_recorded","civic.process.result_published"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":[]},"adapters":["ai","mail","video","web"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","feed-card","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":false}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-conversation', '0.1.0', 'sha256:d34738c97b3bde499a21aa63987633997e396268a2b7e205b23cf2ee1490a865', 'Conversations', 'conversation', 'civic.polis_deliberation',
   '{"activities":{"emit":["civic.process.started","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["deliberation_submissions","deliberation_votes","deliberation_drafts"]},"adapters":["ai","deliberation"],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","nav-section","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":true}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).'),
  ('@civic-social/plugin-wordcloud', '0.1.0', 'sha256:7614ff733b288563cc8881429b9b1e20d27d449931c9f93202141692c4e6b431', 'Word clouds', 'wordcloud', 'civic.wordcloud',
   '{"activities":{"emit":["civic.process.started","civic.process.submission_received","civic.process.result_published","civic.process.ended"],"listen":[]},"state":{"read":["own-process"],"write":["own-process"],"tables":["wordcloud_submissions"]},"adapters":[],"network":{"egress":[]},"identity":{"claims":["participant-ref"]},"ui":{"surfaces":["process-page","create-page","feed-card","settings-panel"]}}'::jsonb,
   '{"result":"passed","ran_at":"2026-10-26T03:07:31Z","commit":"b2fa4a0","walked":true}'::jsonb,
   'approved', 'Adam Lake: shipped with the hub (plugin session 1, 2026-10-25)', '2026-10-26T03:07:31Z'::timestamptz, 'Shipped with the hub: pre-approved (ADR-014).')
ON CONFLICT (package, version, hash) DO NOTHING;

-- Every existing hub has every shipped package installed, as it had every
-- process type before packages: the record of it.
DO $$
DECLARE h text;
BEGIN
  FOR h IN SELECT id FROM hubs ORDER BY id LOOP
    PERFORM public._civic_install_approved_plugins(h, 'system:shipped');
  END LOOP;
END $$;

-- Where a hub has a plugin switched off, its record says so (the switch
-- stays the gate; 20261025000100 keeps the two equal from now on).
UPDATE hub_plugins hp
   SET removed_at = now(), removed_by = 'system:shipped'
  FROM hub_settings s
 WHERE s.hub_id = hp.hub_id
   AND s.key = 'plugin.' || hp.plugin || '.enabled'
   AND lower(btrim(s.value)) IN ('false', '0', 'off', 'no')
   AND hp.removed_at IS NULL
   AND hp.installed_by = 'system:shipped';
