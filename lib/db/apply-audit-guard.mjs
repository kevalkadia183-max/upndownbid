import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to install the audit guard.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(`
    CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit events are append-only';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
    CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
  `);
} finally {
  await pool.end();
}