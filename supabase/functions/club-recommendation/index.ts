import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseClient, getAuthUser, getProfile, isSubscriptionActive } from '../_shared/supabase.ts';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.39.0';

function maybeParseJson(text: string) {
  const trimmed = text.trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(trimmed); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = getSupabaseClient(authHeader);
    const user = await getAuthUser(supabase);
    if (!user) return new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const profile = await getProfile(supabase, user.id);
    if (!profile) return new Response(JSON.stringify({ detail: 'Profile not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!isSubscriptionActive(profile)) return new Response(JSON.stringify({ detail: 'Active subscription required', code: 'subscription_required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const clubs = profile.clubs || {};
    if (Object.keys(clubs).length === 0) return new Response(JSON.stringify({ detail: 'Club distances not set up' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { distance, lie, wind } = await req.json();

    let prompt = 'I need a club recommendation for my next golf shot. Here are my details:\nMy club distances:\n';
    for (const [club, dist] of Object.entries(clubs)) {
      prompt += `${club}: ${dist} yards\n`;
    }
    prompt += `Current situation:
    - Distance to hole: ${distance} yards
    - Current lie: ${lie}
    - Wind conditions: ${wind}

    Return ONLY valid JSON with this exact shape (no markdown, no extra keys):
    {
      "recommendedClub": "7-Iron",
      "why": ["bullet 1", "bullet 2"],
      "tips": ["tip 1", "tip 2"],
      "adjustments": ["optional bullet 1"]
    }`;

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = maybeParseJson(raw);
    const body = parsed ? { data: parsed, status: 'success' } : { advice: raw, status: 'success', format: 'text' };

    return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ detail: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
