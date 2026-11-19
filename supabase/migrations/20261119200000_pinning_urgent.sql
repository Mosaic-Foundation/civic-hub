-- Pinning becomes a plugin (kernel step 4, Adam, 2026-11-19): "if it can be a
-- plugin, it is one". The Urgent label moves from Announcements to the
-- Pinning plugin, as a flag on any pin: whoever may pin may mark a pin
-- urgent, and the newest urgent pin is the line across the top of the
-- space's pages.
--
--   process_pins.urgent   true: listed first on the Pinned card, marked
--                         Urgent, and a candidate for the line across the
--                         top. Defaults to false.
--
-- Each announcement marked urgent right now (state.urgent = true, its
-- urgent_until not passed) is pinned urgent until the same date, so nothing
-- that reads as urgent today stops reading so. One already pinned is marked
-- urgent, its own end date kept unless it had none. The announcements' own
-- urgent fields are left in their state, unread.
--
-- The right column's card for pins was called "announcements" in the
-- space's saved card order (nav.aside_cards); it is the Pinning plugin's
-- "pinned" card now, so a saved order keeps its place and its on/off.
--
-- Additive: one new column with a default, a copy and a rename. Applies twice
-- without error.

ALTER TABLE process_pins ADD COLUMN IF NOT EXISTS urgent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN process_pins.urgent IS
  'Marked urgent: listed first on the Pinned card and shown as the line across the top of the space''s pages (kernel step 4; was Announcements'' Urgent label).';

-- A date that does not parse is read as missing (as in 20261118230000).
CREATE OR REPLACE FUNCTION pg_temp.civic_urgent_ts(v text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}([T ][0-9:.]+)?(Z|[+-]\d{2}(:?\d{2})?)?$' THEN
    RETURN NULL;
  END IF;
  RETURN v::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

INSERT INTO process_pins AS pins (hub_id, process_id, pinned_by, pinned_at, pinned_until, urgent)
SELECT p.hub_id,
       p.id,
       NULL,
       now(),
       pg_temp.civic_urgent_ts(p.state->>'urgent_until'),
       true
  FROM processes p
 WHERE p.type = 'civic.announcement'
   AND p.state->>'urgent' = 'true'
   AND (NULLIF(p.state->>'urgent_until', '') IS NULL OR pg_temp.civic_urgent_ts(p.state->>'urgent_until') > now())
ON CONFLICT (hub_id, process_id) DO UPDATE
   SET urgent = true,
       pinned_until = COALESCE(pins.pinned_until, EXCLUDED.pinned_until);

UPDATE hub_settings
   SET value = replace(value, '"id":"announcements"', '"id":"pinned"')
 WHERE key = 'nav.aside_cards'
   AND value LIKE '%"id":"announcements"%';
