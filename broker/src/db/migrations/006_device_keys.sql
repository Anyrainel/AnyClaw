CREATE TABLE device_keys (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    server_id   UUID         NOT NULL REFERENCES servers(id)  ON DELETE CASCADE,
    session_id  TEXT         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mobile_pk   BYTEA        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (session_id, server_id)
);
CREATE INDEX device_keys_server_idx ON device_keys(server_id);
