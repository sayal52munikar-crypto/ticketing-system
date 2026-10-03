-- 023_create_sessions.sql
-- Login sessions, stored in PostgreSQL (by connect-pg-simple) instead of the server's memory.
-- In memory, every restart or deploy logs everyone out, and Render's free plan restarts the
-- app whenever it has been idle. In the database, sessions survive restarts.
--
-- Column names and types are the ones connect-pg-simple expects.

CREATE TABLE sessions (
    sid     text        PRIMARY KEY,   -- the session ID stored in the browser cookie
    sess    json        NOT NULL,      -- the session data, e.g. {"customerId": 42}
    expire  timestamptz NOT NULL       -- when the session stops being valid
);

-- connect-pg-simple regularly deletes expired sessions: DELETE ... WHERE expire < now().
CREATE INDEX sessions_expire_idx ON sessions (expire);
