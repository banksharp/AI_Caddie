import { supabase } from './supabase';

// Same error extraction as api.js (copied so this file stays independent of it).
async function extractFunctionError(error) {
  let msg = error.message;
  let code;
  try {
    const body = await error.context?.json();
    if (body?.detail) msg = body.detail;
    if (body?.code) code = body.code;
  } catch {}
  // FunctionsFetchError = the request never reached the server (offline, DNS, timeout).
  const offline = error.name === 'FunctionsFetchError';
  const err = new Error(offline ? 'No connection. Check your signal and try again.' : msg);
  if (code) err.code = code;
  if (offline) err.offline = true;
  if (typeof error.context?.status === 'number') err.status = error.context.status;
  return err;
}

/**
 * Asks Club Sense for advice on the next shot. `payload` follows the `shot-recommendation`
 * request in docs/gps-contracts.md (distances only, never coordinates).
 * Resolves to `{ data: ShotAdvice, status }` or the text fallback `{ advice, status, format: 'text' }`.
 * Throws an Error with the server's `detail` as message, plus `code` ('subscription_required'),
 * `status` (HTTP status) and `offline` (true when the request could not be sent) when applicable.
 */
export async function getShotRecommendation(payload) {
  const { data, error } = await supabase.functions.invoke('shot-recommendation', { body: payload });
  if (error) throw await extractFunctionError(error);
  return data;
}
