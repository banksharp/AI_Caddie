import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient, getSupabaseAdmin, getAuthUser } from '../_shared/supabase.ts';
import {
  getAppleConfig,
  getSubscriptionState,
  appAccountTokenMismatch,
} from '../_shared/apple.ts';

// Apple subscription status codes: 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked.
const STATUS_EXPIRED = 2;
const STATUS_REVOKED = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = getSupabaseClient(authHeader);
    const user = await getAuthUser(supabase);
    if (!user) return json({ detail: 'Not authenticated' }, 401);

    const admin = getSupabaseAdmin();
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('apple_original_transaction_id')
      .eq('id', user.id)
      .single();

    if (profErr || !profile?.apple_original_transaction_id) {
      return json({ ok: false, detail: 'No stored Apple subscription to sync' }, 200);
    }

    const originalId = profile.apple_original_transaction_id as string;

    const appleConfig = getAppleConfig();
    if (!appleConfig) {
      return json({ detail: 'Subscription sync not configured' }, 503);
    }

    const { state, error: stateErr } = await getSubscriptionState(appleConfig, 'auto', originalId);
    if (!state) {
      console.log(JSON.stringify({ fn: 'subscription-sync', user: user.id, originalId, error: stateErr }));
      return json({ ok: false, detail: 'Apple subscription lookup failed', raw: stateErr }, 200);
    }
    console.log(JSON.stringify({
      fn: 'subscription-sync', user: user.id, originalId, environment: state.environment,
      status: state.status, chains: state.chains,
    }));

    // Purchases made with appAccountToken are bound to the account that bought them.
    if (appAccountTokenMismatch(state.transaction, user.id)) {
      return json({ ok: false, detail: 'This App Store purchase belongs to a different account' }, 403);
    }

    if (!state.expiresMs) {
      return json({ ok: false, detail: 'Could not read expiration from Apple' }, 200);
    }

    // Expired or refunded subscriptions lose access now, whatever the transaction's date says.
    const now = Date.now();
    const ended = state.status === STATUS_EXPIRED || state.status === STATUS_REVOKED;
    const expiresAt = new Date(ended ? Math.min(state.expiresMs, now) : state.expiresMs);
    const subscriptionWillRenew = ended ? false : state.willRenew;

    const { error: upErr } = await admin
      .from('profiles')
      .update({
        subscription_expires_at: expiresAt.toISOString(),
        subscription_will_renew: subscriptionWillRenew,
      })
      .eq('id', user.id);

    if (upErr) return json({ detail: upErr.message }, 500);

    const active = !ended && expiresAt.getTime() > now;
    return json({
      ok: true,
      subscription_active: active,
      subscription_expires_at: expiresAt.toISOString(),
      subscription_will_renew: subscriptionWillRenew,
    });
  } catch (err) {
    return json({ detail: (err as Error).message }, 500);
  }
});
