-- Migration: 012_immutable_audit_events_trigger.sql
-- Enforces database-level append-only immutability on audit_events

-- 1. Create Trigger Function to block UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'SECURITY VIOLATION: audit_events table is append-only. UPDATE operations are strictly prohibited for forensic immutability.'
      USING ERRCODE = '55000'; -- Object not modifiable
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SECURITY VIOLATION: audit_events table is append-only. DELETE operations are strictly prohibited for forensic immutability.'
      USING ERRCODE = '55000'; -- Object not modifiable
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach Trigger on audit_events for UPDATE or DELETE
DROP TRIGGER IF EXISTS trg_prevent_audit_events_mutation ON audit_events;

CREATE TRIGGER trg_prevent_audit_events_mutation
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_events_mutation();
