-- MOOODFY 0004 — atomic song classification.
--
-- Scope: turn a MusicBrainz recording into a local song on first classification
-- and write the caller's three votes (Mood / Energia / Atmosfera) in ONE
-- transaction. Nothing else: no consensus percentages, no community_validated
-- transition, no admin, no streaming links, no public catalog browsing.
--
-- Why SECURITY DEFINER (and why it is safe here):
--   * The write is a single logical operation (import/reuse the song + its
--     source + three votes). If the app were allowed to do it step by step,
--     RLS would have to grant direct INSERT/UPDATE on songs, song_sources and
--     classification_votes to `authenticated`, which is exactly the bypass this
--     migration removes.
--   * The function is therefore the intentional write seam. It is hardened:
--       - `set search_path = ''` so every reference must be schema-qualified and
--         a caller cannot shadow a table or function through the search path;
--       - `auth.uid()` must be non-null (anonymous callers are rejected even
--         though EXECUTE is revoked from them anyway);
--       - `user_id` is never taken from an argument: it is always auth.uid(),
--         so a caller cannot vote as somebody else;
--       - every argument is validated (MBID shape, title length, and exactly
--         three (dimension, value) pairs whose value must belong to that fixed
--         dimension, checked against the database, not just the client);
--       - the canonical MusicBrainz URL is built from the validated MBID, never
--         taken from the caller;
--       - errors are fixed tokens with no provider or user data in them;
--       - `execute` is revoked from PUBLIC and anon and granted only to
--         `authenticated`.
--   * The function only ever writes rows derived from its validated arguments
--     and auth.uid(). It cannot be used to read or write anything else.
--
-- Idempotency: additive statements plus drop-if-exists/create pairs for policies
-- and create-or-replace for the function. No table is dropped, no data deleted.

-- ---------------------------------------------------------------------------
-- 1. songs.created_by — who first brought this recording into the catalog
-- ---------------------------------------------------------------------------
-- Nullable on purpose: rows imported by a future trusted server job have no
-- user, and the column is only used by the pending/external visibility rule.
-- `on delete set null` keeps the row when an account disappears.
alter table public.songs
  add column if not exists created_by uuid references auth.users (id) on delete set null;

create index if not exists songs_created_by_idx on public.songs (created_by);

-- ---------------------------------------------------------------------------
-- 2. songs visibility: published, own, or classified by me
-- ---------------------------------------------------------------------------
-- Replaces the 0002 policy of the same name; 0002 itself is not modified.
--   * published statuses stay public;
--   * an `external`/`community_pending` song is visible to the user who created
--     it and to every user who classified it (that is what makes the detail page
--     readable right after a first classification);
--   * `rejected` is never public, and never becomes visible through a vote
--     because the function refuses to classify a rejected song.
-- No recursion: songs -> classification_votes -> auth.uid(), and the votes
-- policy only reads auth.uid(), so nothing loops back into songs.
drop policy if exists "songs_select_published_or_own_pending" on public.songs;

create policy "songs_select_published_or_own_pending"
  on public.songs
  for select
  to anon, authenticated
  using (
    status in ('community_validated', 'editorial_verified')
    or (
      status in ('external', 'community_pending')
      and (
        created_by = (select auth.uid())
        or exists (
          select 1
          from public.classification_votes v
          where v.song_id = songs.id
            and v.user_id = (select auth.uid())
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. classification_votes: the function owns every write
-- ---------------------------------------------------------------------------
-- 0002 granted insert/update/delete to `authenticated` and added three
-- own-row policies. Both are removed here: a direct write would bypass the
-- import step, and would let a client classify an arbitrary song id without
-- ever creating/reusing its source. The owner-only SELECT policy is kept so a
-- user can still read back their own selections.
drop policy if exists "classification_votes_insert_own" on public.classification_votes;
drop policy if exists "classification_votes_update_own" on public.classification_votes;
drop policy if exists "classification_votes_delete_own" on public.classification_votes;

revoke insert, update, delete on public.classification_votes from authenticated;

-- Re-stated so the read path is explicit and survives a future revoke-all.
grant select on public.classification_votes to authenticated;
grant select on public.classification_votes to anon;

-- ---------------------------------------------------------------------------
-- 4. public.classify_song — the atomic write seam
-- ---------------------------------------------------------------------------
-- Returns the song UUID. The app resolves the three value ids from the public
-- reference tables before calling; the function re-checks them against the
-- database anyway. Value ids arrive as text so that a malformed one produces the
-- same stable token as a wrong one, instead of a raw cast error.
-- Stable error tokens (SQLSTATE P0001, message = token):
--   not_authenticated | invalid_mbid | invalid_title | invalid_value |
--   song_rejected
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

  -- One row per dimension, replacing the caller's previous selection. The
  -- composite FK (value_id, dimension_id) is the database-level guarantee that
  -- a vote's value belongs to the vote's dimension.
  insert into public.classification_votes (user_id, song_id, dimension_id, value_id)
  select v_user, v_song_id, d.id, w.value_id
  from (
    values
      ('mood', v_mood::uuid),
      ('energia', v_energia::uuid),
      ('atmosfera', v_atmosfera::uuid)
  ) as w (slug, value_id)
  join public.dimensions d on d.slug = w.slug
  on conflict (user_id, song_id, dimension_id)
  do update set value_id = excluded.value_id, updated_at = now();

  return v_song_id;
end;
$$;

comment on function public.classify_song(text, text, text, text, text) is
  'Atomic classification seam: imports or reuses the MusicBrainz recording, then upserts the caller''s three dimension votes. SECURITY DEFINER because it must write songs/song_sources/classification_votes as one transaction; authenticated callers have no direct write grants on those tables.';

-- Only signed-in users may call it. CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default, so both PUBLIC and anon are revoked explicitly.
revoke all on function public.classify_song(text, text, text, text, text) from public;
revoke all on function public.classify_song(text, text, text, text, text) from anon;
grant execute on function public.classify_song(text, text, text, text, text) to authenticated;
