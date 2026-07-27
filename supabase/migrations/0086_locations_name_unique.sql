-- Case-insensitive, per-org uniqueness on location names — the DATABASE-level
-- backstop behind the application duplicate guard added with the entry UI.
--
-- The UI guard (LocationPicker create + heading rename) stays the friendly path
-- users see, but it is application-level and therefore only a nudge: two tabs,
-- or any future create path, could still slip a duplicate through. Two "Monroe
-- Complex" rows in one org with fields split between them would read as a bug
-- and be painful to untangle, so uniqueness is enforced here for real.
--
-- Applied NOW because `locations` is empty (0 rows, verified) — the index is
-- guaranteed to apply cleanly. This is the deliberate opposite of `venues`,
-- where uniqueness was declined precisely because live rows already exist and
-- the same index could fail on real data.
--
-- lower(name) matches the app guard's case-insensitive comparison, so the two
-- agree on what "duplicate" means. A raw 23505 from this index must never reach
-- the user — the create/rename paths catch it and show the same friendly
-- "A location with that name already exists" message.

create unique index locations_owner_name_uniq
  on public.locations (owner_id, lower(name));
