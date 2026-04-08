CREATE TABLE servers (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT         NOT NULL,
    version         TEXT,
    server_pk       BYTEA        NOT NULL,
    status          TEXT         NOT NULL DEFAULT 'offline'
                                 CHECK (status IN ('online','degraded','offline')),
    last_heartbeat  TIMESTAMPTZ,
    capabilities    TEXT[]       NOT NULL DEFAULT '{}',
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX servers_user_idx   ON servers(user_id);
CREATE INDEX servers_status_idx ON servers(status);
