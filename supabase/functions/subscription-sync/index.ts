import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient, getSupabaseAdmin, getAuthUser } from '../_shared/supabase.ts';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

async function importPKCS8(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey('pkcs8', binary, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

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

    const keyId = Deno.env.get('APPLE_KEY_ID')!;
    const issuerId = Deno.env.get('APPLE_ISSUER_ID')!;
    const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY')!.replace(/\\n/g, '\n');
    const bundleId = Deno.env.get('APPLE_BUNDLE_ID')!;
    const sandbox = Deno.env.get('APPLE_SANDBOX') === 'true';

    if (!keyId || !issuerId || !privateKeyPem || !bundleId) {
      return json({ detail: 'Subscription sync not configured' }, 503);
    }

    const privateKey = await importPKCS8(privateKeyPem);
    const now = Math.floor(Date.now() / 1000);
    const token = await create(
      { alg: 'ES256', kid: keyId, typ: 'JWT' },
      {
        iss: issuerId,
        iat: now,
        exp: getNumericDate(300),
        aud: 'appstoreconnect-v1',
        bid: bundleId,
      },
      privateKey,
    );

    const baseUrl = sandbox
      ? 'https://api.storekit-sandbox.itunes.apple.com'
      : 'https://api.storekit.itunes.apple.com';

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
    if (!txPayload?.expiresDate) {
      return json({ ok: false, detail: 'Could not read expiration from Apple' }, 200);
    }

    const expirationMs = txPayload.expiresDate as number;
    const expiresAt = new Date(expirationMs);

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
