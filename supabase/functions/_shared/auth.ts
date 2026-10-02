import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
import { getAuthUser, getSupabaseClient } from './supabase.ts';

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Verifies the caller's Supabase JWT. Returns the user and a client scoped to that user
 * (RLS applies), or a ready-to-return 401 Response.
 */
export async function requireUser(
  req: Request,
): Promise<{ user: User; supabase: SupabaseClient } | { error: Response }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { error: jsonResponse({ detail: 'Not authenticated' }, 401) };

  const supabase = getSupabaseClient(authHeader);
  const user = await getAuthUser(supabase);
  if (!user) return { error: jsonResponse({ detail: 'Not authenticated' }, 401) };
  return { user, supabase };
}
