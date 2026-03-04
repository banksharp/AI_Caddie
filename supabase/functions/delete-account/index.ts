import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient, getSupabaseAdmin, getAuthUser } from '../_shared/supabase.ts';

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
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ detail: error.message }, 500);

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (err) {
    return json({ detail: (err as Error).message }, 500);
  }
});
