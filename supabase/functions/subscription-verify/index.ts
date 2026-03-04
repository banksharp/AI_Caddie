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

    const keyId = Deno.env.get('APPLE_KEY_ID')!;
    const issuerId = Deno.env.get('APPLE_ISSUER_ID')!;
    const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY')!.replace(/\\n/g, '\n');
    const bundleId = Deno.env.get('APPLE_BUNDLE_ID')!;
    const sandbox = Deno.env.get('APPLE_SANDBOX') === 'true';

    if (!keyId || !issuerId || !privateKeyPem || !bundleId) return json({ detail: 'Subscription verification not configured' }, 503);

    const privateKey = await importPKCS8(privateKeyPem);
    const now = Math.floor(Date.now() / 1000);
    const token = await create(
      { alg: 'ES256', kid: keyId, typ: 'JWT' },
      { iss: issuerId, iat: now, exp: getNumericDate(300), aud: 'appstoreconnect-api' },
      privateKey,
    );

    const baseUrl = sandbox
      ? 'https://api.storekit-sandbox.itunes.apple.com'
      : 'https://api.storekit.itunes.apple.com';

    const r = await fetch(`${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok) {
      const err = await r.text();
      return json({ detail: 'Invalid or expired transaction', raw: err }, 400);
    }

    const data = await r.json();
    const signedTransactionInfo = data.signedTransactionInfo;
    if (!signedTransactionInfo) return json({ detail: 'No transaction info in response' }, 400);

    const parts = signedTransactionInfo.split('.');
    if (parts.length !== 3) return json({ detail: 'Invalid signed transaction' }, 400);

    const payload = JSON.parse(atob(parts[1]));
    const expirationMs = payload.expiresDate;
    if (!expirationMs) return json({ detail: 'Transaction has no expiration' }, 400);

    const expiresAt = new Date(expirationMs);
    if (expiresAt <= new Date()) return json({ detail: 'Subscription already expired' }, 400);

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ subscription_expires_at: expiresAt.toISOString() })
      .eq('id', user.id);

    if (error) return json({ detail: error.message }, 500);

    return json({ subscription_active: true, subscription_expires_at: expiresAt.toISOString() });
  } catch (err) {
    return json({ detail: (err as Error).message }, 500);
  }
});
