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

    const adminSecret = req.headers.get('x-admin-secret');
    if (adminSecret !== Deno.env.get('ADMIN_SECRET')) return json({ detail: 'Forbidden' }, 403);

    const { years = 100 } = await req.json();
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + years);

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ subscription_expires_at: expiresAt.toISOString() })
      .eq('id', user.id);

    if (error) return json({ detail: error.message }, 500);

    return json({ message: 'Subscription granted', expires_at: expiresAt.toISOString() });
  } catch (err) {
    return json({ detail: (err as Error).message }, 500);
  }
});
