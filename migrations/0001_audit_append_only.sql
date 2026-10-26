-- Custom SQL migration file, put your code below! --

-- audit_log is append-only. Rows, once written, cannot be mutated or deleted
-- through normal DML. This is a barrier, not a guarantee — a superuser can
-- still ALTER TABLE DISABLE TRIGGER. The point is: application code cannot
-- accidentally corrupt the audit trail, and deliberate mutations require a
-- DDL operation (which Postgres logs separately).

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_change
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();