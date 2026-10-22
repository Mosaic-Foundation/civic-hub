-- process_links.to_iri — the linked process's IRI beside its bare id
-- (Architecture 3, ADR-010; audit D; Adam, 2026-10-21, Q2/field row 6).
--
-- Today to_id is a same-hub foreign key and the wire computes each process's
-- IRI at read time from its frozen hostname (ADR-008). Storing the IRI beside
-- the id is the seam cross-hub links need: a link to a process on another hub
-- has no local row to point at, only an IRI. Nothing reads the column yet.
--
-- Additive: one nullable column, backfilled from each linked process's own
-- frozen wire_hostname — the hostname its IRI was minted on — in the https
-- form every real hostname serves. (A developer's local-stack hub with a
-- .localhost hostname serves its IRIs with a scheme and port from env; those
-- rows exist only on local stacks and the column is not yet read.) New links
-- write it at insert (src/services/processLinks.ts). Never raises; no 40001.

ALTER TABLE process_links ADD COLUMN IF NOT EXISTS to_iri TEXT;

UPDATE process_links pl
   SET to_iri = 'https://' || p.wire_hostname || '/process/' || pl.to_id
  FROM processes p
 WHERE pl.to_iri IS NULL
   AND p.hub_id = pl.hub_id
   AND p.id = pl.to_id
   AND p.wire_hostname IS NOT NULL;

NOTIFY pgrst, 'reload schema';
