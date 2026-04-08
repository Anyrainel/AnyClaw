CREATE TABLE sessions (
    id             TEXT         PRIMARY KEY,
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name    TEXT,
    device_os      TEXT,
    ip_address     INET,
    refresh_token  TEXT         NOT NULL UNIQUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_active    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL
);
CREATE INDEX sessions_user_idx       ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX sessions_refresh_idx    ON sessions(refresh_token);
