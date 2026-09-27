import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient, getSupabaseAdmin, getAuthUser } from '../_shared/supabase.ts';
import {
  getAppleConfig,
  getAppleBaseUrl,
  createAppStoreToken,
  decodeJwsPayload,
  appAccountTokenMismatch,
} from '../_shared/apple.ts';

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

    const token = await createAppStoreToken(appleConfig);
    const baseUrl = getAppleBaseUrl(appleConfig);

    const r = await fetch(`${baseUrl}/inApps/v1/subscriptions/${encodeURIComponent(originalId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok) {
      const err = await r.text();
      return json({ ok: false, detail: 'Apple subscription lookup failed', raw: err }, 200);
    }

    const body = await r.json() as {
      data?: Array<{ lastTransactions?: Array<{ signedTransactionInfo?: string; signedRenewalInfo?: string }> }>;
    };

    let signedTransactionInfo: string | undefined;
    let signedRenewalInfo: string | undefined;

    for (const g of body.data ?? []) {
      const lt = g.lastTransactions;
      if (Array.isArray(lt) && lt.length > 0) {
        signedTransactionInfo = lt[0].signedTransactionInfo;
        signedRenewalInfo = lt[0].signedRenewalInfo;
        break;
      }
    }

    if (!signedTransactionInfo) {
      return json({ ok: false, detail: 'No subscription transactions from Apple' }, 200);
    }

    const txPayload = decodeJwsPayload(signedTransactionInfo);
    if (!txPayload) {
      return json({ ok: false, detail: 'Could not read transaction from Apple' }, 200);
    }

    // Purchases made with appAccountToken are bound to the account that bought them.
    if (appAccountTokenMismatch(txPayload, user.id)) {
      return json({ ok: false, detail: 'This App Store purchase belongs to a different account' }, 403);
    }

    if (typeof txPayload.expiresDate !== 'number') {
      return json({ ok: false, detail: 'Could not read expiration from Apple' }, 200);
    }

    const expiresAt = new Date(txPayload.expiresDate);

    let subscriptionWillRenew = true;
    if (signedRenewalInfo) {
      const renewalPayload = decodeJwsPayload(signedRenewalInfo);
      if (renewalPayload?.autoRenewStatus !== undefined) {
        subscriptionWillRenew = renewalPayload.autoRenewStatus === 1;
      }
    }

    const { error: upErr } = await admin
      .from('profiles')
      .update({
        subscription_expires_at: expiresAt.toISOString(),
        subscription_will_renew: subscriptionWillRenew,
      })
      .eq('id', user.id);

    if (upErr) return json({ detail: upErr.message }, 500);

    const active = expiresAt > new Date();
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
