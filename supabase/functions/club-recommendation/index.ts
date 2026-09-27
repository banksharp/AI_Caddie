import { corsHeaders } from '../_shared/cors.ts';
import {
  formatClubs, generateStructured, jsonResponse, requireSubscriberClubs, toNumber, toText,
} from '../_shared/ai.ts';

const stringArray = { type: 'array', items: { type: 'string' } };

const SCHEMA = {
  type: 'object',
  properties: {
    recommendedClub: { type: 'string', description: 'The single club to hit, e.g. "7-Iron"' },
    why: { ...stringArray, description: 'Short bullets explaining the choice' },
    tips: { ...stringArray, description: 'Short execution tips for this shot' },
    adjustments: { ...stringArray, description: 'Adjustments for lie/wind; may be empty' },
  },
  required: ['recommendedClub', 'why', 'tips', 'adjustments'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const gate = await requireSubscriberClubs(req);
    if ('error' in gate) return gate.error;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ detail: 'Invalid JSON body' }, 400);
    }

    const distance = toNumber(body?.distance);
    if (distance === null || distance <= 0 || distance > 1000) {
      return jsonResponse({ detail: 'distance must be a number of yards between 1 and 1000' }, 400);
    }
    const lie = toText(body.lie);
    const wind = toText(body.wind);
    if (!lie || !wind) return jsonResponse({ detail: 'lie and wind are required' }, 400);

    const prompt = `I need a club recommendation for my next golf shot.

My club distances:
${formatClubs(gate.clubs)}

Current situation:
- Distance to hole: ${distance} yards
- Current lie: ${lie}
- Wind conditions: ${wind}

Recommend one club from my bag. Keep each bullet short (one sentence). Use an empty adjustments list if none are needed.`;

    const result = await generateStructured({ prompt, schema: SCHEMA, effort: 'low' });
    return jsonResponse(result);
  } catch (err) {
    console.error(err);
    return jsonResponse({ detail: (err as Error).message }, 500);
  }
});
