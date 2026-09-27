-- Lock down client writes to public.profiles.
--
-- Problem: policy "Users update own profile" (001) only checked row ownership, and
-- Supabase grants table-wide UPDATE to anon/authenticated by default. Any signed-in
-- user could therefore call
--   supabase.from('profiles').update({ subscription_expires_at: '2099-01-01' })
-- with the public anon key and get a free subscription (same for
-- subscription_will_renew, apple_original_transaction_id, email, id).
--
-- Fix: RLS decides WHICH ROWS a user may touch; column privileges decide WHICH
-- COLUMNS. The client only ever writes `clubs` (mobile/src/api.js setupClubs), so
-- that is the only column the authenticated role may update. All subscription
-- writes happen in edge functions via the service_role key (getSupabaseAdmin),
-- which is unaffected by these grants and bypasses RLS.

-- 1. Column-level UPDATE privileges.
revoke update on public.profiles from anon, authenticated;
grant update (clubs) on public.profiles to authenticated;
-- If the app later lets users edit their name, add: first_name, last_name.
-- NEVER grant subscription_*, apple_original_transaction_id, email or id.

-- 2. Profiles are created only by the security-definer trigger handle_new_user()
--    (runs as the function owner, not the caller, so it is unaffected) and deleted
--    only via auth.users cascade / the delete-account edge function (service_role).
--    Clients never need INSERT/DELETE, and TRUNCATE bypasses RLS entirely.
revoke insert, delete, truncate on public.profiles from anon, authenticated;

-- 3. Add WITH CHECK so an update can't move a row to another user's id
--    (defense in depth; `id` is also no longer updatable per step 1).
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
