import { corsHeaders } from '../_shared/cors.ts';
import { bagFromClubs, generateStructured, jsonResponse, requireSubscriberClubs } from '../_shared/ai.ts';
import { buildPrompt, normalizeAdvice, parseShotRequest, SHOT_ADVICE_SCHEMA } from './prompt.ts';

// Request/response contract: docs/gps-contracts.md → `shot-recommendation`.
// Only distances are received (never coordinates); nothing from the request is logged.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const gate = await requireSubscriberClubs(req);
    if ('error' in gate) return gate.error;

    const bag = bagFromClubs(gate.clubs);
    if (bag.length === 0) return jsonResponse({ detail: 'Club distances not set up' }, 400);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ detail: 'Invalid JSON body' }, 400);
    }

    const parsed = parseShotRequest(body);
    if (!parsed.ok) return jsonResponse({ detail: parsed.detail }, 400);

    const prompt = buildPrompt(parsed.value, bag);
    const result = await generateStructured({ prompt, schema: SHOT_ADVICE_SCHEMA, effort: 'low' });

    if ('data' in result) {
      return jsonResponse({ data: normalizeAdvice(result.data, bag, parsed.value), status: 'success' });
    }
    return jsonResponse(result);
  } catch (err) {
    console.error('shot-recommendation failed:', (err as Error)?.name ?? 'Error');
    return jsonResponse({ detail: 'Unable to get shot advice right now. Please try again.' }, 500);
  }
});
