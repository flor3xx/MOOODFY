-- MOOODFY — dimensions and their approved values.
-- Scope: only the vocabulary behind Mood / Energia / Atmosfera.
-- Tracks, votes, users and gamification are intentionally not modelled yet.

create table if not exists public.dimensions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  sort_order smallint not null
);

create table if not exists public.dimension_values (
  id uuid primary key default gen_random_uuid(),
  dimension_id uuid not null references public.dimensions (id) on delete cascade,
  value text not null,
  sort_order smallint not null,
  unique (dimension_id, value)
);

alter table public.dimensions enable row level security;
alter table public.dimension_values enable row level security;

-- Reference data: readable by anyone, writable only with the service role.
drop policy if exists "dimensions are public" on public.dimensions;
create policy "dimensions are public"
  on public.dimensions for select
  to anon, authenticated
  using (true);

drop policy if exists "dimension values are public" on public.dimension_values;
create policy "dimension values are public"
  on public.dimension_values for select
  to anon, authenticated
  using (true);

insert into public.dimensions (slug, label, sort_order) values
  ('mood', 'Mood', 1),
  ('energia', 'Energia', 2),
  ('atmosfera', 'Atmosfera', 3)
on conflict (slug) do update
  set label = excluded.label, sort_order = excluded.sort_order;

insert into public.dimension_values (dimension_id, value, sort_order)
select d.id, v.value, v.sort_order
from (
  values
    ('mood', 'Felice', 1),
    ('mood', 'Malinconico', 2),
    ('mood', 'Arrabbiato', 3),
    ('mood', 'Romantico', 4),
    ('mood', 'Nostalgico', 5),
    ('mood', 'Rilassato', 6),
    ('mood', 'Chill', 7),
    ('mood', 'Oscuro', 8),
    ('mood', 'Ansioso', 9),
    ('mood', 'Euforico', 10),
    ('mood', 'Riflessivo', 11),
    ('mood', 'Ribelle', 12),
    ('energia', 'Molto bassa', 1),
    ('energia', 'Bassa', 2),
    ('energia', 'Media', 3),
    ('energia', 'Alta', 4),
    ('energia', 'Esplosiva', 5),
    ('atmosfera', 'Notturna', 1),
    ('atmosfera', 'Calda', 2),
    ('atmosfera', 'Fredda', 3),
    ('atmosfera', 'Intima', 4),
    ('atmosfera', 'Spaziosa', 5),
    ('atmosfera', 'Eterea', 6),
    ('atmosfera', 'Ipnotica', 7),
    ('atmosfera', 'Gritty', 8),
    ('atmosfera', 'Luminosa', 9),
    ('atmosfera', 'Misteriosa', 10),
    ('atmosfera', 'Fantasy', 11)
) as v (slug, value, sort_order)
join public.dimensions d on d.slug = v.slug
on conflict (dimension_id, value) do update
  set sort_order = excluded.sort_order;
