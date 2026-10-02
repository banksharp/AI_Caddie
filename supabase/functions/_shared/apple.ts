import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

export interface AppleConfig {
  keyId: string;
  issuerId: string;
  privateKeyPem: string;
  bundleId: string;
}

/** Reads App Store Server API config from env. Returns null if anything required is missing. */
export function getAppleConfig(): AppleConfig | null {
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const issuerId = Deno.env.get('APPLE_ISSUER_ID');
  const rawPrivateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  const bundleId = Deno.env.get('APPLE_BUNDLE_ID');

  if (!keyId || !issuerId || !rawPrivateKey || !bundleId) return null;

  return {
    keyId,
    issuerId,
    privateKeyPem: rawPrivateKey.replace(/\\n/g, '\n'),
    bundleId,
  };
}

const APPLE_PRODUCTION_URL = 'https://api.storekit.itunes.apple.com';
const APPLE_SANDBOX_URL = 'https://api.storekit-sandbox.itunes.apple.com';

/**
 * GETs an App Store Server API path, trying production first and falling back to sandbox
 * when production returns 404 (Apple's recommended approach). Real App Store purchases
 * resolve in production; TestFlight and App Review purchases exist only in sandbox.
 */
export type AppleEnvironment = 'Production' | 'Sandbox';

export async function appleGet(config: AppleConfig, path: string) {
  const production = await appleGetIn(config, 'Production', path);
  if (production.status !== 404) return { response: production, environment: 'Production' as AppleEnvironment };

  await production.body?.cancel();
  return { response: await appleGetIn(config, 'Sandbox', path), environment: 'Sandbox' as AppleEnvironment };
}

/** GETs an App Store Server API path in one specific environment. */
export async function appleGetIn(config: AppleConfig, environment: AppleEnvironment, path: string) {
  const token = await createAppStoreToken(config);
  const baseUrl = environment === 'Production' ? APPLE_PRODUCTION_URL : APPLE_SANDBOX_URL;
  return await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

export interface SubscriptionState {
  expiresMs: number | null;
  willRenew: boolean;
  /** Apple status: 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked. */
  status: number | null;
  transaction: Record<string, unknown>;
}

/**
 * Current state of a subscription from Apple's Get All Subscription Statuses endpoint.
 * A single transaction only covers one billing period (minutes long in sandbox, where
 * renewals are accelerated), so checking whichever transaction the device sent can report
 * an active subscription as expired. This returns the latest transaction for the chain.
 */
export async function getSubscriptionState(
  config: AppleConfig,
  environment: AppleEnvironment,
  originalTransactionId: string,
): Promise<{ state: SubscriptionState | null; error?: string }> {
  const r = await appleGetIn(config, environment, `/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`);
  if (!r.ok) return { state: null, error: await r.text() };

  const body = await r.json() as {
    data?: Array<{ lastTransactions?: Array<{ originalTransactionId?: string; status?: number; signedTransactionInfo?: string; signedRenewalInfo?: string }> }>;
  };
  const items = (body.data ?? []).flatMap((g) => g.lastTransactions ?? []);
  const item = items.find((t) => t.originalTransactionId === originalTransactionId) ?? items[0];
  if (!item?.signedTransactionInfo) return { state: null, error: 'No subscription transactions from Apple' };

  const transaction = decodeJwsPayload(item.signedTransactionInfo);
  if (!transaction) return { state: null, error: 'Could not read transaction from Apple' };

  let willRenew = true;
  if (item.signedRenewalInfo) {
    const renewal = decodeJwsPayload(item.signedRenewalInfo);
    if (renewal?.autoRenewStatus !== undefined) willRenew = renewal.autoRenewStatus === 1;
  }

  return {
    state: {
      expiresMs: typeof transaction.expiresDate === 'number' ? transaction.expiresDate : null,
      willRenew,
      status: typeof item.status === 'number' ? item.status : null,
      transaction,
    },
  };
}

async function importPKCS8(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey('pkcs8', binary, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Creates a short-lived ES256 JWT for the App Store Server API. */
export async function createAppStoreToken(config: AppleConfig) {
  const privateKey = await importPKCS8(config.privateKeyPem);
  const now = Math.floor(Date.now() / 1000);
  return await create(
    { alg: 'ES256', kid: config.keyId, typ: 'JWT' },
    {
      iss: config.issuerId,
      iat: now,
      exp: getNumericDate(300),
      aud: 'appstoreconnect-v1',
      bid: config.bundleId,
    },
    privateKey,
  );
}

function base64UrlDecode(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes the payload segment of a JWS returned by the App Store Server API.
 * Note: the signature is not verified here — the JWS is fetched directly from Apple over TLS.
 */
export function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * True when the transaction was bound to a different user via appAccountToken.
 * Transactions without an appAccountToken (older purchases) are not considered a mismatch.
 */
export function appAccountTokenMismatch(payload: Record<string, unknown>, userId: string) {
  const token = payload.appAccountToken;
  if (typeof token !== 'string' || token.length === 0) return false;
  return token.toLowerCase() !== userId.toLowerCase();
}
