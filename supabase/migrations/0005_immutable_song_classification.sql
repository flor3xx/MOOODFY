-- MOOODFY 0005 — immutable song classification.
--
-- Scope: make a user's classification of a song one-time and permanent.
-- 0004's function upserted the caller's three votes (INSERT ... ON CONFLICT DO
-- UPDATE), so a user could re-classify the same song and silently replace the
-- previous selection. That path is removed here: a caller who already has a
-- classification row for the resolved song is refused with the stable token
-- `already_classified`, and the whole transaction aborts without touching a row.
-- A first classification still writes the three rows atomically.
--
-- Why SECURITY DEFINER (unchanged from 0004): the function remains the only
-- write seam for songs / song_sources / classification_votes; `authenticated`
-- has no direct write grants on those tables and RLS stays the read rule. The
-- function keeps the same signature, hardening (`set search_path = ''`, auth.uid
-- identity, argument validation, advisory lock) and grants.
--
-- Idempotency: create-or-replace for the function, then comment and grants; no
-- table is dropped and no data is deleted. The `already_classified` rule lives
-- in the function, not in RLS, because the function is the only writer.

-- Stable error tokens (SQLSTATE P0001, message = token):
--   not_authenticated | invalid_mbid | invalid_title | invalid_value |
--   already_classified | song_rejected
create or replace function public.classify_song(
  p_mbid text,
  p_title text,
  p_mood_value_id text,
  p_energia_value_id text,
  p_atmosfera_value_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid_shape constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_user uuid := auth.uid();
  v_mbid text;
  v_title text;
  v_mood text;
  v_energia text;
  v_atmosfera text;
  v_pairs integer;
  v_song_id uuid;
  v_status text;
  v_already_classified boolean;
begin
  -- Authorization: the caller must be a signed-in user; user_id is never an
  -- argument, so nobody can classify on behalf of somebody else.
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- MBID shape, then canonical form. Everything downstream (the source row and
  -- the MusicBrainz URL) is built from this validated value.
  v_mbid := lower(btrim(coalesce(p_mbid, '')));
  if v_mbid !~ v_uuid_shape then
    raise exception 'invalid_mbid';
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) < 1 or length(v_title) > 500 then
    raise exception 'invalid_title';
  end if;

  v_mood := lower(btrim(coalesce(p_mood_value_id, '')));
  v_energia := lower(btrim(coalesce(p_energia_value_id, '')));
  v_atmosfera := lower(btrim(coalesce(p_atmosfera_value_id, '')));
  if v_mood !~ v_uuid_shape or v_energia !~ v_uuid_shape or v_atmosfera !~ v_uuid_shape then
    raise exception 'invalid_value';
  end if;

  -- Exactly three pairs, and each value must belong to its own fixed dimension.
  -- The join drops wrong-dimension pairs, so a count of 3 means all three are
  -- valid; a duplicated value id can never reach 3.
  select count(*)
    into v_pairs
  from (
    values
      ('mood', v_mood::uuid),
      ('energia', v_energia::uuid),
      ('atmosfera', v_atmosfera::uuid)
  ) as w (slug, value_id)
  join public.dimensions d on d.slug = w.slug
  join public.dimension_values dv on dv.id = w.value_id and dv.dimension_id = d.id;

  if v_pairs <> 3 then
    raise exception 'invalid_value';
  end if;

  -- Serialize on the provider identity: two concurrent first classifications of
  -- the same recording would otherwise both find nothing and both insert a song
  -- (the unique (provider, external_id) would then abort one of them).
  perform pg_advisory_xact_lock(hashtextextended('musicbrainz:' || v_mbid, 0));

  select s.id, s.status
    into v_song_id, v_status
  from public.song_sources src
  join public.songs s on s.id = src.song_id
  where src.provider = 'musicbrainz'
    and src.external_id = v_mbid;

  if v_song_id is not null then
    -- An excluded song stays excluded.
    if v_status = 'rejected' then
      raise exception 'song_rejected';
    end if;
    -- Already imported but never classified: promote it, keeping the original
    -- creator. Validated/editorial statuses are intentionally left alone.
    if v_status = 'external' then
      update public.songs
         set status = 'community_pending',
             created_by = coalesce(created_by, v_user),
             updated_at = now()
       where id = v_song_id;
    end if;
  else
    insert into public.songs (title, status, created_by)
    values (v_title, 'community_pending', v_user)
    returning id into v_song_id;

    insert into public.song_sources (song_id, provider, external_id, external_url)
    values (
      v_song_id,
      'musicbrainz',
      v_mbid,
      'https://musicbrainz.org/recording/' || v_mbid
    );
  end if;

  -- Immutability: one classification per user and song. If the caller already
  -- classified this song (any dimension row exists), refuse before writing
  -- anything. `raise exception` aborts the transaction, so the song
  -- resolution/promotion above is rolled back too: no row changes.
  select exists (
    select 1
    from public.classification_votes v
    where v.user_id = v_user
      and v.song_id = v_song_id
  ) into v_already_classified;

  if v_already_classified then
    raise exception 'already_classified';
  end if;

  -- One row per dimension, written once. There is no ON CONFLICT: the check
  -- above (serialized by the advisory lock per song) guarantees these are new,
  -- and the unique (user_id, song_id, dimension_id) is the backstop. The
  -- composite FK (value_id, dimension_id) guarantees a vote's value belongs to
  -- the vote's dimension.
  insert into public.classification_votes (user_id, song_id, dimension_id, value_id)
  select v_user, v_song_id, d.id, w.value_id
  from (
    values
      ('mood', v_mood::uuid),
      ('energia', v_energia::uuid),
      ('atmosfera', v_atmosfera::uuid)
  ) as w (slug, value_id)
  join public.dimensions d on d.slug = w.slug;

  return v_song_id;
end;
$$;

comment on function public.classify_song(text, text, text, text, text) is
  'Atomic classification seam: imports or reuses the MusicBrainz recording, then inserts the caller''s three dimension votes exactly once. A caller who already classified the song is refused with the stable token `already_classified`. SECURITY DEFINER because it must write songs/song_sources/classification_votes as one transaction; authenticated callers have no direct write grants on those tables.';

-- Only signed-in users may call it. CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default, so both PUBLIC and anon are revoked explicitly.
revoke all on function public.classify_song(text, text, text, text, text) from public;
revoke all on function public.classify_song(text, text, text, text, text) from anon;
grant execute on function public.classify_song(text, text, text, text, text) to authenticated;
