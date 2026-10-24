-- The actor's DID, frozen at emission (Architecture 4, ADR-011, item 5).
-- Additive: two nullable columns, one trigger function replaced with the same
-- body plus one step. No existing row changes; no account has a DID today, so
-- nothing anyone has published or will publish changes until a person sets one.
--
--   users.identity_did_source   who set identity_did. 'self' is the only
--                               value: the person set it on their own account
--                               (a future DID sign-in, proving control of the
--                               DID). A DID the hub minted or assigned has no
--                               source and is never projected (Adam, Q4).
--   events.wire_actor_did       the acting account's DID when the event was
--                               stored, copied by the insert trigger from
--                               users.identity_did when its source is 'self'.
--                               Like the other wire columns (ADR-008), stamped
--                               once and never recomputed: setting or changing
--                               a DID later changes no event already stored.
--
-- What the column does on the wire is the serializer's (src/events/
-- activitySerializer.ts): the DID replaces the account's /users/<id> IRI
-- wherever the event's type's disclosure policy already serves the actor, and
-- never for the anonymous policy, which serves no actor at all. Redaction
-- (src/events/publicRedaction.ts) hides it wherever it hides the actor.
-- Never raises 40001.

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_did_source text NULL
  CONSTRAINT users_identity_did_source_chk CHECK (identity_did_source IS NULL OR identity_did_source = 'self');
COMMENT ON COLUMN users.identity_did_source IS
  'Who set identity_did: ''self'' (the person, on their own account) or null. Only a self-set DID is projected onto events (ADR-011).';
COMMENT ON COLUMN users.identity_did IS
  'The person''s own DID (ADR-004 reserved it; ADR-011 projects it onto their events when identity_did_source is ''self''). Nothing in the hub sets it yet.';

ALTER TABLE events ADD COLUMN IF NOT EXISTS wire_actor_did text NULL;
COMMENT ON COLUMN events.wire_actor_did IS
  'The acting account''s self-set DID when the event was stored (ADR-011), stamped by trigger and never recomputed. Null when it had none. The app never writes it.';

-- events: the hub's hostname now, the process's and actor's, and the actor's DID.
CREATE OR REPLACE FUNCTION public._civic_event_stamp_wire()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id text;
  participant boolean;
BEGIN
  IF NEW.wire_hostname IS NULL THEN
    SELECT h.hostname INTO NEW.wire_hostname FROM hubs h WHERE h.id = NEW.hub_id;
  END IF;

  IF NEW.wire_process_hostname IS NULL AND NEW.process_id IS NOT NULL AND NEW.process_id <> '' THEN
    SELECT p.wire_hostname INTO NEW.wire_process_hostname
      FROM processes p WHERE p.hub_id = NEW.hub_id AND p.id = NEW.process_id;
  END IF;
  IF NEW.wire_process_hostname IS NULL THEN
    NEW.wire_process_hostname := NEW.wire_hostname;
  END IF;

  -- A participant: anything but machinery, a DID or anonymous (the same
  -- test as isParticipantActor in src/events/publicRedaction.ts).
  participant := coalesce(btrim(NEW.actor), '') <> ''
     AND NEW.actor NOT LIKE 'did:%'
     AND NEW.actor NOT LIKE 'system:%'
     AND NEW.actor NOT IN ('system', 'anonymous');
  IF participant THEN
    actor_id := CASE WHEN NEW.actor LIKE 'user:%' THEN substr(NEW.actor, 6) ELSE NEW.actor END;
  END IF;

  IF NEW.wire_actor_hostname IS NULL AND participant THEN
    SELECT u.wire_hostname INTO NEW.wire_actor_hostname
      FROM users u WHERE u.hub_id = NEW.hub_id AND u.id = actor_id;
  END IF;
  IF NEW.wire_actor_hostname IS NULL THEN
    NEW.wire_actor_hostname := NEW.wire_hostname;
  END IF;

  -- The person's own DID, only when they set it themselves.
  IF NEW.wire_actor_did IS NULL AND participant THEN
    SELECT u.identity_did INTO NEW.wire_actor_did
      FROM users u
     WHERE u.hub_id = NEW.hub_id AND u.id = actor_id
       AND u.identity_did_source = 'self' AND u.identity_did LIKE 'did:%';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname::text FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public._civic_event_stamp_wire() FROM %I', r);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._civic_event_stamp_wire() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
