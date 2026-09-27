import { corsHeaders } from '../_shared/cors.ts';
import {
  formatClubs, generateStructured, jsonResponse, requireSubscriberClubs, toNumber, toText,
} from '../_shared/ai.ts';

const shotProps = {
  club: { type: 'string' },
  aim: { type: 'string' },
  notes: { type: 'string' },
};

const situationShot = {
  type: 'object',
  properties: {
    situation: { type: 'string', description: 'Shot number and distance it is played from, e.g. "3rd shot from 80 yards"' },
    ...shotProps,
  },
  required: ['situation', 'club', 'aim', 'notes'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    teeShot: {
      type: 'object',
      properties: {
        ...shotProps,
        shape: { type: 'string', description: 'Optional shot shape, e.g. "slight draw"' },
      },
      required: ['club', 'aim', 'notes'],
      additionalProperties: false,
    },
    secondShot: situationShot,
    otherShots: { type: 'array', items: situationShot },
    approach: {
      type: 'object',
      properties: shotProps,
      required: ['club', 'aim', 'notes'],
      additionalProperties: false,
    },
    avoid: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['teeShot', 'otherShots', 'approach', 'avoid', 'notes'],
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

    const holePar = toNumber(body?.hole_par);
    if (holePar === null || !Number.isInteger(holePar) || holePar < 3 || holePar > 6) {
      return jsonResponse({ detail: 'hole_par must be a whole number between 3 and 6' }, 400);
    }
    const holeLength = toNumber(body.hole_length);
    if (holeLength === null || holeLength <= 0 || holeLength > 1000) {
      return jsonResponse({ detail: 'hole_length must be a number of yards between 1 and 1000' }, 400);
    }
    const hazards = toText(body.hazards);
    const holeShape = toText(body.hole_shape);
    if (!hazards || !holeShape) return jsonResponse({ detail: 'hazards and hole_shape are required' }, 400);

    const prompt = `I need advice on how to play this golf hole strategically.

Hole details:
- Par: ${holePar}
- Length: ${holeLength} yards
- Shape: ${holeShape}
- Hazards: ${hazards}

My club distances:
${formatClubs(gate.clubs)}

Plan the shots in strict order: 1st (tee), 2nd, 3rd, ... last (approach onto the green).
Distances must be consistent: each shot is played FROM the distance left after the previous shot. If the 2nd shot "leaves 80 yards", the next shot is from 80 yards; if it leaves 5-10 yards short of the green, the next shot is a short chip from 5-10 yards.
In each shot's "situation" or "notes", state the distance that shot is played from (e.g. "From 195 yards").
"approach" is the final shot onto the green from whatever distance the previous shot left.
Omit secondShot when the approach is the 2nd shot (e.g. most par 3s and short par 4s); use an empty otherShots list when there are no shots between secondShot and the approach. Keep avoid and notes to short bullets.`;

    const result = await generateStructured({ prompt, schema: SCHEMA, effort: 'medium' });
    return jsonResponse(result);
  } catch (err) {
    console.error(err);
    return jsonResponse({ detail: (err as Error).message }, 500);
  }
});
