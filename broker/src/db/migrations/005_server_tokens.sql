CREATE TABLE server_tokens (
    token       TEXT         PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed     BOOLEAN      NOT NULL DEFAULT FALSE,
    server_id   UUID                 REFERENCES servers(id) ON DELETE SET NULL,
    mobile_pk   BYTEA        NOT NULL,
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX server_tokens_user_idx ON server_tokens(user_id);
