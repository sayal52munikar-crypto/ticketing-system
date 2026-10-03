-- 013_create_refund_audit_log.sql
-- A permanent history of every refund status change, written automatically
-- by a trigger so the app can't forget (or skip) logging.

BEGIN;

CREATE TABLE refund_audit_log (
    log_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    refund_id   bigint      NOT NULL,
    old_status  text,                 -- NULL when the refund was just created
    new_status  text        NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now(),
    changed_by  text        NOT NULL DEFAULT current_user,

    -- RESTRICT: a refund with audit history can never be deleted.
    CONSTRAINT refund_audit_log_refund_fk
        FOREIGN KEY (refund_id) REFERENCES refunds (refund_id) ON DELETE RESTRICT
);

CREATE INDEX refund_audit_log_refund_id_idx ON refund_audit_log (refund_id);

CREATE FUNCTION log_refund_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO refund_audit_log (refund_id, old_status, new_status)
        VALUES (NEW.refund_id, NULL, NEW.status);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO refund_audit_log (refund_id, old_status, new_status)
        VALUES (NEW.refund_id, OLD.status, NEW.status);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_audit
    AFTER INSERT OR UPDATE OF status ON refunds
    FOR EACH ROW
    EXECUTE FUNCTION log_refund_status_change();

COMMIT;
