-- MOOODFY 0002 — catalog and community classification domain.
--
-- Scope: artists/albums/songs, their provider identifiers and streaming links,
-- and the community classification votes (Mood / Energia / Atmosfera).
--
-- Deliberately NOT in this migration:
--   * the community_validated transition (3 distinct users + >=60% Mood consensus):
--     it will be a later, reviewed migration (function or webhook-driven job);
--   * admin/editorial roles and editorial labels: no authorization model exists yet,
--     and guessing one here would create an insecure policy;
--   * any provider response storage: only stable identifiers and canonical URLs;
--   * profiles: current auth (email + password) needs none, so none is created.
--
-- Idempotency: every statement is additive and re-runnable (IF NOT EXISTS, DO-block
-- guards on pg_constraint/pg_policies/pg_type). There are no DROP statements.
--
-- updated_at: no trigger is installed; writers set updated_at explicitly. A shared
-- touch_updated_at() trigger is a later seam, not a reason to weaken this one.

-- ---------------------------------------------------------------------------
-- 0. Prerequisite on 0001
-- ---------------------------------------------------------------------------
-- classification_votes stores (value_id, dimension_id) as a composite foreign key,
-- which requires a unique constraint on exactly that column pair. `id` is already
-- the primary key, so this constraint is redundant for uniqueness but makes the
-- composite FK target possible -- and it is what guarantees, in the database, that
-- a vote's value really belongs to the vote's dimension (requirement 7).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dimension_values_id_dimension_id_key'
      and conrelid = 'public.dimension_values'::regclass
  ) then
    alter table public.dimension_values
      add constraint dimension_values_id_dimension_id_key unique (id, dimension_id);
  end if;
end $$;

-- Shared domain for MusicBrainz identifiers: stable external IDs only, never blobs.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'musicbrainz_id' and n.nspname = 'public'
  ) then
    create domain public.musicbrainz_id as text
      constraint musicbrainz_id_format
      check (value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. artists
-- ---------------------------------------------------------------------------
create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint artists_name_length check (length(btrim(name)) between 1 and 300),
  musicbrainz_artist_id public.musicbrainz_id unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.artists enable row level security;

-- ---------------------------------------------------------------------------
-- 2. albums
-- ---------------------------------------------------------------------------
-- No artist column on purpose: an album can have several artists and the model
-- does not support multi-artist albums yet. Album/artist relations are a later
-- migration (album_artists, mirroring song_artists); forcing one artist now would
-- have to be undone.
--
-- release_date holds the provider date and release_date_precision says how much
-- of it is real (MusicBrainz returns YYYY, YYYY-MM or YYYY-MM-DD). Without the
-- precision a partial date would be stored as a fabricated day.
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint albums_title_length check (length(btrim(title)) between 1 and 500),
  musicbrainz_release_group_id public.musicbrainz_id unique,
  musicbrainz_release_id public.musicbrainz_id unique,
  release_date date,
  release_date_precision text
    constraint albums_release_date_precision_values
    check (release_date_precision is null or release_date_precision in ('year', 'month', 'day')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint albums_release_date_precision_pair
    check (
      (release_date is null and release_date_precision is null)
      or (release_date is not null and release_date_precision is not null)
    )
);

alter table public.albums enable row level security;

-- ---------------------------------------------------------------------------
-- 3. songs
-- ---------------------------------------------------------------------------
-- status lifecycle:
--   external             imported from a provider, not classified yet
--   community_pending    classified by at least one user, not validated yet
--   community_validated  reached 3 distinct users and >=60% Mood consensus
--   editorial_verified   reviewed by a human editor (future workflow)
--   rejected             not eligible; never publicly readable
-- Visibility is enforced by the RLS policies below, not by the application.
create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint songs_title_length check (length(btrim(title)) between 1 and 500),
  album_id uuid references public.albums (id) on delete set null,
  duration_ms integer
    constraint songs_duration_range check (duration_ms is null or (duration_ms > 0 and duration_ms <= 36000000)),
  release_date date,
  release_date_precision text
    constraint songs_release_date_precision_values
    check (release_date_precision is null or release_date_precision in ('year', 'month', 'day')),
  status text not null default 'external'
    constraint songs_status_valid
    check (status in ('external', 'community_pending', 'community_validated', 'editorial_verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint songs_release_date_precision_pair
    check (
      (release_date is null and release_date_precision is null)
      or (release_date is not null and release_date_precision is not null)
    )
);

create index if not exists songs_status_idx on public.songs (status);
create index if not exists songs_album_id_idx on public.songs (album_id);

-- Title lookup index: case-insensitive exact match and ordered scans. Deliberately
-- no extension is enabled here and no tsvector column is generated yet:
--   * substring search (`ILIKE '%brand%'`) will need pg_trgm with a GIN index;
--   * full-text search can use core `to_tsvector('simple', title)` in a generated
--     column later, without any extension.
-- Both are real needs for the local-dataset slice; neither is needed while search
-- still runs against MusicBrainz, so this migration stays extension-free.
create index if not exists songs_title_lower_idx on public.songs (lower(title));

alter table public.songs enable row level security;

-- ---------------------------------------------------------------------------
-- 4. song_artists (many-to-many, ordered, one primary per song)
-- ---------------------------------------------------------------------------
create table if not exists public.song_artists (
  song_id uuid not null references public.songs (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  position smallint not null
    constraint song_artists_position_range check (position >= 0 and position <= 100),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (song_id, artist_id),
  constraint song_artists_song_position_key unique (song_id, position)
);

-- At most one primary artist per song.
create unique index if not exists song_artists_single_primary_idx
  on public.song_artists (song_id)
  where is_primary;

create index if not exists song_artists_artist_id_idx on public.song_artists (artist_id);

alter table public.song_artists enable row level security;

-- ---------------------------------------------------------------------------
-- 5. song_sources (provider identifiers)
-- ---------------------------------------------------------------------------
-- Only stable identifiers and the canonical public URL. No provider payloads, no
-- credits, no cover art: those stay out of the database by design.
create table if not exists public.song_sources (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  provider text not null
    constraint song_sources_provider_known check (provider in ('musicbrainz')),
  external_id text not null
    constraint song_sources_external_id_length check (length(btrim(external_id)) between 1 and 200),
  external_url text
    constraint song_sources_external_url_https
    check (external_url is null or external_url ~ '^https://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint song_sources_provider_external_id_key unique (provider, external_id),
  -- MusicBrainz identifiers keep their shape even in the generic column.
  constraint song_sources_musicbrainz_id_format
    check (
      provider <> 'musicbrainz'
      or external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
);

create index if not exists song_sources_song_id_idx on public.song_sources (song_id);

alter table public.song_sources enable row level security;

-- ---------------------------------------------------------------------------
-- 6. streaming_links (metadata only, never audio)
-- ---------------------------------------------------------------------------
create table if not exists public.streaming_links (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  platform text not null
    constraint streaming_links_platform_known
    check (platform in ('spotify', 'apple_music', 'youtube', 'bandcamp', 'deezer', 'soundcloud')),
  url text not null
    constraint streaming_links_url_https
    check (url ~ '^https://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  constraint streaming_links_song_platform_key unique (song_id, platform)
);

-- No extra index on song_id: the unique (song_id, platform) constraint already
-- indexes that column as its leading column.

alter table public.streaming_links enable row level security;

-- ---------------------------------------------------------------------------
-- 7. classification_votes
-- ---------------------------------------------------------------------------
-- One selected value per dimension per user and song: unique (user_id, song_id,
-- dimension_id). Changing the value is an UPDATE by the owner, deleting is a
-- DELETE by the owner.
--
-- (value_id, dimension_id) is a composite FK into dimension_values (id, dimension_id)
-- -- see the 0001 prerequisite above -- so a vote cannot store a value that belongs
-- to another dimension. That invariant lives in the database, not in client code.
--
-- user_id references auth.users, the identity source. No role/authorization data is
-- duplicated here and users never get to write any: RLS below allows only rows whose
-- user_id is the caller.
create table if not exists public.classification_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  dimension_id uuid not null,
  value_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classification_votes_user_song_dimension_key unique (user_id, song_id, dimension_id),
  constraint classification_votes_value_belongs_to_dimension
    foreign key (value_id, dimension_id)
    references public.dimension_values (id, dimension_id)
    on delete restrict
);

create index if not exists classification_votes_song_id_idx on public.classification_votes (song_id);
create index if not exists classification_votes_dimension_id_idx on public.classification_votes (dimension_id);
-- (user_id, song_id, dimension_id) is already indexed by its unique constraint.

alter table public.classification_votes enable row level security;

-- ---------------------------------------------------------------------------
-- 8. Data API grants
-- ---------------------------------------------------------------------------
-- New tables in `public` are no longer auto-exposed to the Data API, so the roles
-- need explicit grants. RLS (below) still decides which rows are reachable.
-- No service_role or secret grant is added: the admin workflow is designed later.
-- Schema usage on `public` is already granted to anon/authenticated by Supabase.
grant select on public.artists to anon, authenticated;
grant select on public.albums to anon, authenticated;
grant select on public.songs to anon, authenticated;
grant select on public.song_artists to anon, authenticated;
grant select on public.song_sources to anon, authenticated;
grant select on public.streaming_links to anon, authenticated;

-- Additive grant on the 0001 reference tables so the read path can join them; the
-- 0001 migration itself is not modified.
grant select on public.dimensions to anon, authenticated;
grant select on public.dimension_values to anon, authenticated;

-- Classification writes: authenticated only. Anonymous users can never write.
grant select, insert, update, delete on public.classification_votes to authenticated;

-- Anonymous callers also get SELECT on classification_votes. The songs policy below
-- references this table, and a policy expression may only touch relations the caller is
-- allowed to read, so without the grant an anonymous song read could fail with
-- "permission denied for table classification_votes". There is deliberately no anon
-- policy here, so a direct read still returns zero rows: the grant keeps the policy
-- evaluable, it exposes nothing.
grant select on public.classification_votes to anon;

-- ---------------------------------------------------------------------------
-- 9. Policies
-- ---------------------------------------------------------------------------
-- Visibility rules (public read = published statuses only):
--   * songs: status in (community_validated, editorial_verified), plus a
--     community_pending song the caller has classified themselves;
--   * everything hanging off a song (song_artists, song_sources, streaming_links)
--     is readable only when its song is readable -- the `exists (... songs ...)`
--     subqueries below are themselves filtered by the songs policy, so the status
--     rule is written once and never duplicated;
--   * artists/albums are readable when at least one visible song references them;
--   * classification_votes are readable only by their owner. Raw votes are personal
--     data; consensus aggregates will be exposed by a later migration (a view or an
--     aggregate table), not by opening this table to the public.
-- No policy chain loops back on itself: songs -> classification_votes -> auth.uid()
-- and stops, so there is no recursive RLS.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'songs'
      and policyname = 'songs_select_published_or_own_pending'
  ) then
    create policy songs_select_published_or_own_pending
      on public.songs
      for select
      to anon, authenticated
      using (
        status in ('community_validated', 'editorial_verified')
        or (
          status = 'community_pending'
          and exists (
            select 1
            from public.classification_votes v
            where v.song_id = songs.id
              and v.user_id = (select auth.uid())
          )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'song_artists'
      and policyname = 'song_artists_select_visible_song'
  ) then
    create policy song_artists_select_visible_song
      on public.song_artists
      for select
      to anon, authenticated
      using (exists (select 1 from public.songs s where s.id = song_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'song_sources'
      and policyname = 'song_sources_select_visible_song'
  ) then
    create policy song_sources_select_visible_song
      on public.song_sources
      for select
      to anon, authenticated
      using (exists (select 1 from public.songs s where s.id = song_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'streaming_links'
      and policyname = 'streaming_links_select_visible_song'
  ) then
    create policy streaming_links_select_visible_song
      on public.streaming_links
      for select
      to anon, authenticated
      using (exists (select 1 from public.songs s where s.id = song_id));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'albums'
      and policyname = 'albums_select_with_visible_song'
  ) then
    create policy albums_select_with_visible_song
      on public.albums
      for select
      to anon, authenticated
      using (exists (select 1 from public.songs s where s.album_id = albums.id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'artists'
      and policyname = 'artists_select_with_visible_song'
  ) then
    create policy artists_select_with_visible_song
      on public.artists
      for select
      to anon, authenticated
      using (
        exists (
          select 1
          from public.song_artists sa
          join public.songs s on s.id = sa.song_id
          where sa.artist_id = artists.id
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'classification_votes'
      and policyname = 'classification_votes_select_own'
  ) then
    create policy classification_votes_select_own
      on public.classification_votes
      for select
      to authenticated
      using (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'classification_votes'
      and policyname = 'classification_votes_insert_own'
  ) then
    create policy classification_votes_insert_own
      on public.classification_votes
      for insert
      to authenticated
      with check (user_id = (select auth.uid()));
  end if;

  -- UPDATE needs USING (which rows may be touched) and WITH CHECK (what they may
  -- become), so a user can neither edit someone else's vote nor reassign user_id.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'classification_votes'
      and policyname = 'classification_votes_update_own'
  ) then
    create policy classification_votes_update_own
      on public.classification_votes
      for update
      to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'classification_votes'
      and policyname = 'classification_votes_delete_own'
  ) then
    create policy classification_votes_delete_own
      on public.classification_votes
      for delete
      to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Known limits of this migration (next seams)
-- ---------------------------------------------------------------------------
-- a. classification_votes writes do not re-check the song's visibility. Referencing
--    `songs` from this table's WITH CHECK would make songs -> classification_votes ->
--    songs recursive, so it is not done. Consequence: an authenticated user can insert
--    a vote for a song they cannot read (a rejected song stays unreadable, and a
--    community_pending song becomes readable to them -- which is the intended
--    mechanic). Integrity of the reference itself is still enforced by the FKs.
--    Next seam: validate eligibility in a reviewed function/RPC (or an
--    editorial trigger) once the community scoring job exists.
-- b. No INSERT/UPDATE/DELETE policies exist for catalog tables (artists, albums,
--    songs, song_artists, song_sources, streaming_links): imports will run through a
--    trusted server path once the admin/editorial model is designed. Deny-by-default
--    is intentional, not an oversight.
-- c. The community_validated transition (3 distinct users, >=60% Mood consensus) is
--    not implemented here.
