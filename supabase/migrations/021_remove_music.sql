-- Muse focuses on notes, tasks and the assistant: the music hub is removed.
-- Drops playlists (indexes, trigger and policies go with the table).
drop table if exists public.music_playlists cascade;
