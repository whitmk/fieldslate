-- Grant write access on venues to authenticated users.
-- SELECT already works via Supabase defaults; INSERT/UPDATE/DELETE were never
-- explicitly granted, causing silent failures on the Venues page.
grant insert, update, delete on public.venues to authenticated;
