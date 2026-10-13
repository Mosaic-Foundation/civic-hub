-- Sign-in slice (2026-10-14): consolidated city-counties in the place picker.
--
-- The jurisdiction reference list gains one type, `city_county`: a
-- consolidated city-county government, chosen as a single place. Which places
-- those are is data (config/jurisdictions/consolidated.csv), loaded with the
-- list by scripts/load-jurisdictions.ts; this only lets the column hold it.
--
-- Widens a CHECK constraint (drop and re-add, same name): every row valid
-- before is valid after, and code from before this migration never writes
-- the table (only the loader does, as the owner). Never raises 40001.

ALTER TABLE jurisdictions DROP CONSTRAINT IF EXISTS jurisdictions_type_check;
ALTER TABLE jurisdictions ADD CONSTRAINT jurisdictions_type_check CHECK (type IN (
  'state', 'county', 'city', 'town', 'village', 'borough', 'cdp', 'school_district', 'city_county'
));

NOTIFY pgrst, 'reload schema';
