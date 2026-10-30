-- A trusted peer may be reachable only when it initiates an outbound request.
-- In that case it has no callback URL, but can still push to the peer it can reach.
ALTER TABLE sync_peers ALTER COLUMN base_url DROP NOT NULL;
