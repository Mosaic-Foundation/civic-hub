-- Project comments and creator updates move onto the shared comment module
-- (community_inputs), so projects get the same word list, admin hide-with-
-- reason, anonymity handling and audit trail as every other process type.
-- Until now they lived in project_comments / project_updates with none of it
-- (Adam, 2026-09-06: "make projects more in line and universally aligned").
--
-- Copies rows; the old tables are left in place for a later drop once prod
-- is verified. Safe to re-run (ON CONFLICT DO NOTHING on the primary key).

INSERT INTO community_inputs (id, process_id, author_id, body, submitted_at, phase, is_anonymous, author_name)
SELECT c.id, c.project_id, c.user_id, c.content, c.created_at, 'comment', FALSE, u.full_name
FROM project_comments c
LEFT JOIN users u ON u.id = c.user_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO community_inputs (id, process_id, author_id, body, submitted_at, phase, is_anonymous, author_name)
SELECT up.id, up.project_id, p.user_id, up.content, up.created_at, 'update', FALSE, u.full_name
FROM project_updates up
JOIN projects p ON p.id = up.project_id
LEFT JOIN users u ON u.id = p.user_id
ON CONFLICT (id) DO NOTHING;
