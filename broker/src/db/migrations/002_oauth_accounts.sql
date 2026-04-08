CREATE TABLE oauth_accounts (
    provider              TEXT        NOT NULL,
    provider_user_id      TEXT        NOT NULL,
    user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_refresh_enc  BYTEA,
    provider_scopes       TEXT[]      NOT NULL DEFAULT '{}',
    linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX oauth_accounts_user_idx ON oauth_accounts(user_id);
