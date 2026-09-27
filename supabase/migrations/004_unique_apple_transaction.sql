-- One App Store subscription (originalTransactionId) may be linked to at most one account.
-- NOTE: production already has this index (added by hand as profiles_apple_original_transaction_id_uq);
-- the name here matches so this migration is a no-op there and only creates it on fresh databases.
-- subscription-verify checks this before writing; this index is the backstop against races.
--
-- PRE-CHECK: this migration fails if two profiles already share an apple_original_transaction_id.
-- Run this first; it must return zero rows:
--
--   select apple_original_transaction_id, array_agg(id) as profile_ids, count(*)
--   from public.profiles
--   where apple_original_transaction_id is not null
--   group by apple_original_transaction_id
--   having count(*) > 1;
--
-- If it returns rows, decide which account legitimately owns each subscription and clear the
-- column (and, if appropriate, subscription_expires_at) on the others before applying, e.g.:
--
--   update public.profiles
--   set apple_original_transaction_id = null, subscription_expires_at = null
--   where id = '<profile id that should not own it>';

create unique index if not exists profiles_apple_original_transaction_id_uq
  on public.profiles (apple_original_transaction_id)
  where apple_original_transaction_id is not null;
