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

    const { hole_par, hole_length, hazards, hole_shape } = await req.json();

    let prompt = `I need advice on how to play this golf hole strategically:

    Hole details:
    - Par: ${hole_par}
    - Length: ${hole_length} yards
    - Shape: ${hole_shape}
    - Hazards: ${hazards}

    My club distances:\n`;
    for (const [club, dist] of Object.entries(clubs)) {
      prompt += `${club}: ${dist} yards\n`;
    }
    prompt += `Return ONLY valid JSON (no markdown). Plan shots in strict order: 1st (tee), 2nd, 3rd, ... last (approach onto green).
    CRITICAL: Distances must be consistent. Each shot happens FROM the distance left after the previous shot.
    If you say shot 2 "leaves 80 yards", then the next shot is FROM 80 yards, not from 135. If shot 2 "leaves 5-10 yards from green", the next shot is a short chip from 5-10 yards.
    In "situation" or "notes" always state the distance for that shot (e.g. "From 195 yards" or "From 80 yards for 3rd shot"). "approach" = final shot onto the green from whatever distance the previous shot left.
    Use this shape:
    {
      "teeShot": {"club": "...", "aim": "...", "shape": "optional", "notes": "..." },
      "secondShot": {"situation": "e.g. 2nd shot, 195 yards left", "club": "...", "aim": "...", "notes": "..." },
      "otherShots": [
        {"situation": "e.g. 3rd shot from 80 yards", "club": "...", "aim": "...", "notes": "..." }
      ],
      "approach": {"club": "...", "aim": "...", "notes": "final shot onto green from X yards" },
      "avoid": ["risk 1", "risk 2"],
      "notes": ["bullet 1", "bullet 2"]
    }
    Omit secondShot or use [] for otherShots if not needed. Always include teeShot, approach, avoid, and notes.`;

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
