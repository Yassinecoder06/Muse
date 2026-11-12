-- The phone companion app is removed; paired devices and pairing codes are no
-- longer used. External clients now connect through muse-mcp instead.
drop table if exists public.pairing_tokens cascade;
drop table if exists public.remote_devices cascade;
