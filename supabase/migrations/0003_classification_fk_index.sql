-- MOOODFY 0003 — covering index for the composite FK on classification_votes.
--
-- 0002 stores (value_id, dimension_id) with a composite foreign key into
-- dimension_values (id, dimension_id). PostgreSQL indexes the *referenced*
-- side automatically, but not the referencing side, so without this the
-- "performance: unindexed foreign keys" advisor flags the composite FK.
--
-- Additive and idempotent: no DROP, no table rewrite. Plain CREATE INDEX (not
-- CONCURRENTLY) because migrations run inside a transaction and the table is
-- still small; revisit if classification_votes ever grows large.
create index if not exists classification_votes_value_dimension_idx
  on public.classification_votes (value_id, dimension_id);
