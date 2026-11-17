-- A conversation keeps its own summary (kernel step 1, Conversations 0.4.0).
-- Since plugin session 2 (2026-10) a closed conversation's page read the
-- summary from its brief. Its page now reads only the conversation: the
-- summary its result was written into is kept on the conversation's own state
-- (`summary`) when the brief is made, and again when a new version is made.
--
-- This copies the summary each existing brief holds onto its conversation,
-- where the conversation has none yet, so a conversation closed between
-- plugin session 2 and this release shows the same summary as before.
-- A brief's staged version (pending_revision) is not copied: the page showed
-- the published one, and the conversation takes the staged one when it is
-- published. Data only, idempotent, no schema change.

UPDATE processes AS c
   SET state = jsonb_set(c.state, '{summary}', b.state->'content'->'deliberation')
  FROM processes AS b
 WHERE c.type = 'civic.polis_deliberation'
   AND b.type = 'civic.brief'
   AND b.hub_id = c.hub_id
   AND b.state->>'source_process_id' = c.id
   AND jsonb_typeof(b.state->'content'->'deliberation') = 'object'
   AND (c.state->'summary' IS NULL OR jsonb_typeof(c.state->'summary') = 'null');
