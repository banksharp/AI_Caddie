-- Whether the subscription is set to renew at period end (false = user cancelled, still active until expiry)
alter table public.profiles
  add column if not exists subscription_will_renew boolean default true;

-- Stable Apple subscription id (for refreshing status after user cancels in Settings)
alter table public.profiles
  add column if not exists apple_original_transaction_id text;

comment on column public.profiles.subscription_will_renew is
  'From Apple signedRenewalInfo.autoRenewStatus: true if subscription renews; false if cancelled but may still be active until subscription_expires_at';

comment on column public.profiles.apple_original_transaction_id is
  'Apple originalTransactionId from StoreKit; used to refresh subscription / cancel state via App Store Server API';
