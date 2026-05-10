ALTER TABLE servers
ADD COLUMN IF NOT EXISTS connection_mode TEXT CHECK (connection_mode IN ('public_ip', 'wireguard', 'public_tunnel', 'broker_relay')),
ADD COLUMN IF NOT EXISTS public_host TEXT,
ADD COLUMN IF NOT EXISTS public_api_port INTEGER DEFAULT 4100,
ADD COLUMN IF NOT EXISTS public_app_port INTEGER DEFAULT 5173,
ADD COLUMN IF NOT EXISTS public_pb_port INTEGER DEFAULT 8090,
ADD COLUMN IF NOT EXISTS public_use_tls BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS wg_public_key TEXT,
ADD COLUMN IF NOT EXISTS wg_endpoint TEXT,
ADD COLUMN IF NOT EXISTS wg_tunnel_ip TEXT,
ADD COLUMN IF NOT EXISTS wg_port INTEGER DEFAULT 51820;

CREATE INDEX IF NOT EXISTS servers_connection_mode_idx ON servers(connection_mode);
