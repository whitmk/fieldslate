-- Grant table-level permissions to the authenticated role.
-- Tables created via manual SQL migrations in Supabase do not automatically
-- receive the grants that the dashboard applies, so RLS policies alone are
-- insufficient — the role must also have permission to touch the table.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.blackout_dates to authenticated;
grant select on public.blackout_dates to anon;
