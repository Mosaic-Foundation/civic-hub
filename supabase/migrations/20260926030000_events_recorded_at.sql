-- Phase 5 part two, fix 6: when an event was RECORDED, apart from the time it
-- is stamped with.
--
-- `created_at` is the event's own timestamp (src/events/eventStore.ts), and
-- some events are stamped in the past on purpose: news sync uses the item's
-- publication time, and since this phase a vote closed after its deadline —
-- by the hourly job or on read — is stamped with the deadline. The resident
-- digest selected events by that stamp, so a backdated close could fall
-- outside every digest window and never be mailed. It now selects by
-- `recorded_at`, set by the database when the row is written.
--
-- Additive. Existing rows are backfilled from created_at (the best record of
-- when they arrived; without it every past event would look new to the next
-- digest). `events` refuses UPDATE by trigger (events_no_update, append-only);
-- the trigger is disabled for the one backfill statement and re-enabled in
-- the same transaction. New rows get now() from the default; no code writes
-- this column. Production: after 20260926020000.

ALTER TABLE events ADD COLUMN IF NOT EXISTS recorded_at timestamptz;

ALTER TABLE events DISABLE TRIGGER events_no_update;
UPDATE events SET recorded_at = created_at WHERE recorded_at IS NULL;
ALTER TABLE events ENABLE TRIGGER events_no_update;

ALTER TABLE events ALTER COLUMN recorded_at SET DEFAULT now();
ALTER TABLE events ALTER COLUMN recorded_at SET NOT NULL;

COMMENT ON COLUMN events.recorded_at IS
  'When the row was written (database clock). created_at is the event''s own, possibly backdated, timestamp. The digest selects by recorded_at.';

-- The digest's query: one hub's events recorded after a cursor.
CREATE INDEX IF NOT EXISTS events_hub_recorded_idx ON events (hub_id, recorded_at);
