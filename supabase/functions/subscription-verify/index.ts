import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient, getSupabaseAdmin, getAuthUser } from '../_shared/supabase.ts';
import {
  getAppleConfig,
  appleGet,
  getSubscriptionState,
  decodeJwsPayload,
  appAccountTokenMismatch,
} from '../_shared/apple.ts';

const ALREADY_LINKED_DETAIL = 'This App Store subscription is already linked to another account';

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

    const { transactionId } = await req.json();
    if (!transactionId || typeof transactionId !== 'string') return json({ detail: 'transactionId required' }, 400);

    const appleConfig = getAppleConfig();
    if (!appleConfig) return json({ detail: 'Subscription verification not configured' }, 503);

    const { response: r, environment } =
      await appleGet(appleConfig, `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`);

    if (!r.ok) {
      const err = await r.text();
      return json({ detail: 'Invalid or expired transaction', raw: err }, 400);
    }

    const data = await r.json() as {
      signedTransactionInfo?: string;
      signedRenewalInfo?: string;
    };
    const signedTransactionInfo = data.signedTransactionInfo;
    if (!signedTransactionInfo) return json({ detail: 'No transaction info in response' }, 400);

    const payload = decodeJwsPayload(signedTransactionInfo);
    if (!payload) return json({ detail: 'Invalid signed transaction' }, 400);

    // Purchases made with appAccountToken are bound to the account that bought them.
    if (appAccountTokenMismatch(payload, user.id)) {
      return json({ detail: 'This App Store purchase belongs to a different account' }, 403);
    }

    const originalTransactionId =
      typeof payload.originalTransactionId === 'string' ? payload.originalTransactionId : null;

    // The device may send any transaction in the subscription's renewal chain, and each one only
    // covers a single period. Use the subscription's latest state, from the environment the
    // transaction was found in, rather than this transaction's own expiry.
    let expirationMs = typeof payload.expiresDate === 'number' ? payload.expiresDate : null;
    let latestStatus: number | null = null;
    let statusLookupError: string | undefined;

    // autoRenewStatus: 1 = will renew, 0 = cancelled (access may continue until expiresDate)
    let subscriptionWillRenew = true;
    const signedRenewalInfo = data.signedRenewalInfo;
    if (signedRenewalInfo && typeof signedRenewalInfo === 'string') {
      const renewalPayload = decodeJwsPayload(signedRenewalInfo);
      if (renewalPayload?.autoRenewStatus !== undefined) {
        subscriptionWillRenew = renewalPayload.autoRenewStatus === 1;
      }
    }

    if (originalTransactionId) {
      const { state, error: stateErr } = await getSubscriptionState(appleConfig, environment, originalTransactionId);
      if (state) {
        if (appAccountTokenMismatch(state.transaction, user.id)) {
          return json({ detail: 'This App Store purchase belongs to a different account' }, 403);
        }
        if (state.expiresMs && (!expirationMs || state.expiresMs > expirationMs)) expirationMs = state.expiresMs;
        subscriptionWillRenew = state.willRenew;
        latestStatus = state.status;
      } else {
        statusLookupError = stateErr;
      }
    }

    if (!expirationMs) return json({ detail: 'Transaction has no expiration' }, 400);

    const expiresAt = new Date(expirationMs);
    if (expiresAt <= new Date()) {
      return json({
        detail: 'Subscription already expired',
        raw: {
          environment,
          transactionId,
          originalTransactionId,
          productId: payload.productId ?? null,
          sentTransactionExpires: typeof payload.expiresDate === 'number' ? new Date(payload.expiresDate).toISOString() : null,
          latestExpires: expiresAt.toISOString(),
          latestStatus,
          statusLookupError: statusLookupError ?? null,
        },
      }, 400);
    }

    const admin = getSupabaseAdmin();

    // One App Store subscription may only unlock one account.
    if (originalTransactionId) {
      const { data: claimed, error: claimErr } = await admin
        .from('profiles')
        .select('id')
        .eq('apple_original_transaction_id', originalTransactionId)
        .neq('id', user.id)
        .limit(1);

      if (claimErr) return json({ detail: claimErr.message }, 500);
      if (claimed && claimed.length > 0) return json({ detail: ALREADY_LINKED_DETAIL }, 409);
    }

    const updatePayload: Record<string, unknown> = {
      subscription_expires_at: expiresAt.toISOString(),
      subscription_will_renew: subscriptionWillRenew,
    };
    if (originalTransactionId) {
      updatePayload.apple_original_transaction_id = originalTransactionId;
    }

    const { error } = await admin.from('profiles').update(updatePayload).eq('id', user.id);

    if (error) {
      // Unique index on apple_original_transaction_id (migration 004) catches races with the check above.
      if (error.code === '23505') return json({ detail: ALREADY_LINKED_DETAIL }, 409);
      return json({ detail: error.message }, 500);
    }

    return json({
      subscription_active: true,
      subscription_expires_at: expiresAt.toISOString(),
      subscription_will_renew: subscriptionWillRenew,
    });
  } catch (err) {
    return json({ detail: (err as Error).message }, 500);
  }
});
