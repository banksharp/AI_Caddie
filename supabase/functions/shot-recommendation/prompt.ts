// Pure request validation, prompt building and output normalisation for shot-recommendation.
// No Deno/network APIs here so it can be unit-tested directly.
import { clamp, nearestClubName, toEnum, toNumber, toText, type BagClub } from '../_shared/ai.ts';

export const LIES = ['tee', 'fairway', 'first_cut', 'rough', 'deep_rough', 'sand', 'hardpan', 'pine_straw'] as const;
export const WIND_DIRECTIONS = [
  'calm', 'into', 'down', 'left_to_right', 'right_to_left', 'into_left', 'into_right', 'down_left', 'down_right',
] as const;
export const ELEVATIONS = ['flat', 'uphill', 'downhill'] as const;
export const HAZARD_KINDS = ['bunker', 'water', 'lateral_water', 'ob'] as const;
export const SOURCES = ['osm', 'user_pin', 'manual'] as const;
export const SHOT_TYPES = [
  'full', 'three_quarter', 'knockdown', 'punch', 'layup', 'pitch', 'chip', 'bunker', 'putt',
] as const;
export const AIM_SIDES = ['left', 'center', 'right'] as const;
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;

export const MAX_HAZARDS = 8;
const MAX_SIDE_LEN = 20;
const MAX_ITEMS = 5;

export type Lie = typeof LIES[number];
export type WindDirection = typeof WIND_DIRECTIONS[number];
export type Elevation = typeof ELEVATIONS[number];
export type HazardKind = typeof HAZARD_KINDS[number];

export type ShotHazard = {
  kind: HazardKind;
  side: string | null;
  reach_yds: number | null;
  carry_yds: number | null;
  lateral_yds: number | null;
  in_play: boolean;
};

export type ShotRequest = {
  distance_to_pin_yds: number;
  distance_to_front_yds: number | null;
  distance_to_back_yds: number | null;
  hole: { number: number | null; par: number | null; length_yds: number | null };
  shot_number: number | null;
  lie: Lie | null;
  wind: { direction: WindDirection; strength_mph: number } | null;
  elevation: Elevation | null;
  hazards: ShotHazard[];
  gps_accuracy_yds: number | null;
  source: typeof SOURCES[number] | null;
};

const isMissing = (v: unknown) => v === undefined || v === null;

/** Optional number in [min, max]; returns undefined (absent), a number, or an error string. */
function optNumber(v: unknown, min: number, max: number, field: string): number | null | string {
  if (isMissing(v)) return null;
  const n = toNumber(v);
  if (n === null || n < min || n > max) return `${field} must be a number between ${min} and ${max}`;
  return Math.round(n);
}

/** Optional enum: null when absent, the value when valid, an error string otherwise. */
function optEnum<T extends string>(v: unknown, allowed: readonly T[], field: string): T | null | { error: string } {
  if (isMissing(v) || v === '') return null;
  const e = toEnum(v, allowed);
  return e ?? { error: `${field} must be one of: ${allowed.join(', ')}` };
}

/** Validates the request body per docs/gps-contracts.md. */
export function parseShotRequest(body: unknown): { ok: true; value: ShotRequest } | { ok: false; detail: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, detail: 'Request body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const fail = (detail: string) => ({ ok: false as const, detail });

  const pinRaw = toNumber(b.distance_to_pin_yds);
  if (pinRaw === null || pinRaw < 1 || pinRaw > 700) {
    return fail('distance_to_pin_yds is required and must be a number of yards between 1 and 700');
  }

  const front = optNumber(b.distance_to_front_yds, 1, 750, 'distance_to_front_yds');
  if (typeof front === 'string') return fail(front);
  const back = optNumber(b.distance_to_back_yds, 1, 750, 'distance_to_back_yds');
  if (typeof back === 'string') return fail(back);

  const hole = { number: null as number | null, par: null as number | null, length_yds: null as number | null };
  if (!isMissing(b.hole)) {
    if (typeof b.hole !== 'object' || Array.isArray(b.hole)) return fail('hole must be an object');
    const h = b.hole as Record<string, unknown>;
    const num = optNumber(h.number, 1, 36, 'hole.number');
    if (typeof num === 'string') return fail(num);
    const par = optNumber(h.par, 3, 6, 'hole.par');
    if (typeof par === 'string') return fail(par);
    const len = optNumber(h.length_yds, 1, 1000, 'hole.length_yds');
    if (typeof len === 'string') return fail(len);
    Object.assign(hole, { number: num, par, length_yds: len });
  }

  const shot = optNumber(b.shot_number, 1, 20, 'shot_number');
  if (typeof shot === 'string') return fail(shot);

  const lie = optEnum(b.lie, LIES, 'lie');
  if (lie && typeof lie === 'object') return fail(lie.error);

  let wind: ShotRequest['wind'] = null;
  if (!isMissing(b.wind)) {
    if (typeof b.wind !== 'object' || Array.isArray(b.wind)) return fail('wind must be an object');
    const w = b.wind as Record<string, unknown>;
    const dir = toEnum(w.direction, WIND_DIRECTIONS);
    if (!dir) return fail(`wind.direction must be one of: ${WIND_DIRECTIONS.join(', ')}`);
    const mph = optNumber(w.strength_mph, 0, 50, 'wind.strength_mph');
    if (typeof mph === 'string') return fail(mph);
    wind = dir === 'calm' || !mph ? { direction: 'calm', strength_mph: 0 } : { direction: dir, strength_mph: mph };
  }

  const elevation = optEnum(b.elevation, ELEVATIONS, 'elevation');
  if (elevation && typeof elevation === 'object') return fail(elevation.error);

  const hazards: ShotHazard[] = [];
  if (!isMissing(b.hazards)) {
    if (!Array.isArray(b.hazards)) return fail('hazards must be an array');
    if (b.hazards.length > MAX_HAZARDS) return fail(`hazards may contain at most ${MAX_HAZARDS} items`);
    for (const [i, raw] of b.hazards.entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(`hazards[${i}] must be an object`);
      const hz = raw as Record<string, unknown>;
      const kind = toEnum(hz.kind, HAZARD_KINDS);
      if (!kind) return fail(`hazards[${i}].kind must be one of: ${HAZARD_KINDS.join(', ')}`);
      const reach = optNumber(hz.reach_yds, 0, 1000, `hazards[${i}].reach_yds`);
      if (typeof reach === 'string') return fail(reach);
      const carry = optNumber(hz.carry_yds, 0, 1000, `hazards[${i}].carry_yds`);
      if (typeof carry === 'string') return fail(carry);
      const lateral = optNumber(hz.lateral_yds, -1000, 1000, `hazards[${i}].lateral_yds`);
      if (typeof lateral === 'string') return fail(lateral);
      if (!isMissing(hz.in_play) && typeof hz.in_play !== 'boolean') return fail(`hazards[${i}].in_play must be a boolean`);
      const side = toText(hz.side);
      hazards.push({
        kind,
        side: side ? side.slice(0, MAX_SIDE_LEN) : null,
        reach_yds: reach,
        carry_yds: carry,
        lateral_yds: lateral,
        in_play: hz.in_play === true,
      });
    }
  }

  const acc = optNumber(b.gps_accuracy_yds, 0, 10000, 'gps_accuracy_yds');
  if (typeof acc === 'string') return fail(acc);

  const source = optEnum(b.source, SOURCES, 'source');
  if (source && typeof source === 'object') return fail(source.error);

  return {
    ok: true,
    value: {
      distance_to_pin_yds: Math.round(pinRaw),
      distance_to_front_yds: front,
      distance_to_back_yds: back,
      hole,
      shot_number: shot,
      lie: lie as Lie | null,
      wind,
      elevation: elevation as Elevation | null,
      hazards,
      gps_accuracy_yds: acc,
      source: source as ShotRequest['source'],
    },
  };
}

/**
 * Deterministic candidate clubs: up to 3 bag clubs within ±12 yds of the target (closest
 * first). If fewer than 2 fall in that window, the nearest two clubs overall.
 */
export function candidateClubs(bag: BagClub[], targetYds: number, window = 12): BagClub[] {
  const byCloseness = [...bag].sort(
    (a, b) => Math.abs(a.yds - targetYds) - Math.abs(b.yds - targetYds) || b.yds - a.yds,
  );
  const inWindow = byCloseness.filter((c) => Math.abs(c.yds - targetYds) <= window);
  return inWindow.length >= 2 ? inWindow.slice(0, 3) : byCloseness.slice(0, 2);
}

/** One-line hint for the prompt, labelled as a hint. */
export function candidateHint(bag: BagClub[], targetYds: number): string {
  const c = candidateClubs(bag, targetYds);
  if (c.length === 0) return '';
  return `Hint (from distances only, not a rule): clubs closest to ${targetYds} yds are ` +
    c.map((x) => `${x.name} (${x.yds})`).join(', ') + '.';
}

const KIND_LABEL: Record<HazardKind, string> = {
  bunker: 'Bunker',
  water: 'Water',
  lateral_water: 'Lateral water',
  ob: 'Out of bounds',
};

/** e.g. "Water, right, 140 to reach / 162 to carry, in play" */
export function hazardLine(h: ShotHazard): string {
  const parts: string[] = [KIND_LABEL[h.kind]];
  if (h.side) parts.push(h.side);
  const dist: string[] = [];
  if (h.reach_yds !== null) dist.push(`${h.reach_yds} to reach`);
  if (h.carry_yds !== null) dist.push(`${h.carry_yds} to carry`);
  if (dist.length) parts.push(dist.join(' / '));
  if (h.lateral_yds !== null) parts.push(`${Math.abs(h.lateral_yds)} yds off the line`);
  parts.push(h.in_play ? 'in play' : 'probably not in play');
  return parts.join(', ');
}

const WIND_LABEL: Record<WindDirection, string> = {
  calm: 'calm',
  into: 'into the player (headwind)',
  down: 'downwind (helping)',
  left_to_right: 'left to right',
  right_to_left: 'right to left',
  into_left: 'into, from the left',
  into_right: 'into, from the right',
  down_left: 'helping, from the left',
  down_right: 'helping, from the right',
};

export function buildPrompt(req: ShotRequest, bag: BagClub[]): string {
  const pin = req.distance_to_pin_yds;
  const hasWind = !!req.wind && req.wind.direction !== 'calm';
  const hasElevation = !!req.elevation && req.elevation !== 'flat';

  const holeBits: string[] = [];
  if (req.hole.number !== null) holeBits.push(`Hole ${req.hole.number}`);
  if (req.hole.par !== null) holeBits.push(`par ${req.hole.par}`);
  if (req.hole.length_yds !== null) holeBits.push(`${req.hole.length_yds} yds`);
  if (req.shot_number !== null) holeBits.push(`shot ${req.shot_number}`);

  const green: string[] = [];
  if (req.distance_to_front_yds !== null) green.push(`front ${req.distance_to_front_yds}`);
  green.push(`center ${pin}`);
  if (req.distance_to_back_yds !== null) green.push(`back ${req.distance_to_back_yds}`);
  const depth = req.distance_to_front_yds !== null && req.distance_to_back_yds !== null
    ? req.distance_to_back_yds - req.distance_to_front_yds
    : null;

  const lines: string[] = [
    'I am on the golf course in a casual round and need advice for my next shot.',
    '',
    'My bag (club: typical carry in yards), longest to shortest:',
    ...bag.map((c) => `- ${c.name}: ${c.yds}`),
    '',
    candidateHint(bag, pin),
    '',
    'Situation:',
  ];
  if (holeBits.length) lines.push(`- ${holeBits.join(', ')}`);
  lines.push(`- Distance (GPS, yards): ${green.join(' / ')}${depth !== null && depth > 0 ? ` (green is ${depth} yds deep)` : ''}`);
  lines.push(`- Lie: ${req.lie ? req.lie.replace(/_/g, ' ') : 'not given'}`);
  lines.push(`- Wind: ${hasWind ? `${req.wind!.strength_mph} mph, ${WIND_LABEL[req.wind!.direction]}` : req.wind ? 'calm' : 'not given'}`);
  lines.push(`- Elevation: ${req.elevation ?? 'not given'}`);
  if (req.gps_accuracy_yds !== null) lines.push(`- GPS accuracy: about ±${req.gps_accuracy_yds} yds`);
  if (req.source === 'user_pin') lines.push('- Green position was set by the player tapping the map.');
  if (req.source === 'manual') lines.push('- Distances were entered manually.');
  lines.push('', 'Hazards (distances from my position):');
  lines.push(...(req.hazards.length ? req.hazards.map((h) => `- ${hazardLine(h)}`) : ['- none known']));

  lines.push(
    '',
    'Instructions:',
    '- Choose `club` and `alternateClub` only from my bag, using the names exactly as written. Use "" for alternateClub if there is no sensible second choice.',
    '- When hazards guard the green, use the front/back distances to pick a target and club that keeps the likely miss away from them.',
    hasWind || hasElevation
      ? '- Give playsLikeYds as an estimate of the effective distance after wind/elevation, with short playsLikeNotes saying what you adjusted for.'
      : '- No wind or elevation was given: set playsLikeYds equal to carryNeededYds and leave playsLikeNotes empty.',
    '- carryNeededYds is the carry distance to your chosen target, not necessarily the pin.',
    '- aimOffsetYds is how far left/right of the pin to aim (0 with aimSide "center").',
    '- hazardsInPlay lists only hazards that matter for this shot; it may be empty.',
    '- Keep every bullet and note to one short sentence. At most 4 items per list.',
  );
  return lines.join('\n');
}

const str = { type: 'string' };
const strArr = { type: 'array', items: str };

/** JSON schema mirroring ShotAdvice in docs/gps-contracts.md. */
export const SHOT_ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    club: { ...str, description: 'Club from the bag, name exactly as listed' },
    alternateClub: { ...str, description: 'Second choice from the bag, or ""' },
    shotType: { type: 'string', enum: [...SHOT_TYPES] },
    target: {
      type: 'object',
      properties: {
        description: str,
        aimSide: { type: 'string', enum: [...AIM_SIDES] },
        aimOffsetYds: { type: 'integer' },
      },
      required: ['description', 'aimSide', 'aimOffsetYds'],
      additionalProperties: false,
    },
    carryNeededYds: { type: 'integer' },
    playsLikeYds: { type: 'integer' },
    playsLikeNotes: strArr,
    hazardsInPlay: {
      type: 'array',
      items: {
        type: 'object',
        properties: { hazard: str, note: str },
        required: ['hazard', 'note'],
        additionalProperties: false,
      },
    },
    risk: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: [...RISK_LEVELS] },
        bailout: str,
        notes: str,
      },
      required: ['level', 'bailout', 'notes'],
      additionalProperties: false,
    },
    why: strArr,
  },
  required: [
    'club', 'alternateClub', 'shotType', 'target', 'carryNeededYds', 'playsLikeYds',
    'playsLikeNotes', 'hazardsInPlay', 'risk', 'why',
  ],
  additionalProperties: false,
};

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(s).filter(Boolean).slice(0, MAX_ITEMS) : []);
const roundIn = (v: unknown, min: number, max: number, fallback: number) => {
  const n = toNumber(v);
  return Math.round(clamp(n ?? fallback, min, max));
};

/** Enforces the contract on the model output: bag club names, ranges, list caps. */
// deno-lint-ignore no-explicit-any
export function normalizeAdvice(raw: any, bag: BagClub[], req: ShotRequest) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const carry = roundIn(r.carryNeededYds, 1, 750, req.distance_to_pin_yds);
  const noAdjust = !(req.wind && req.wind.direction !== 'calm') && !(req.elevation && req.elevation !== 'flat');
  const playsLike = noAdjust ? carry : roundIn(r.playsLikeYds, 1, 750, carry);

  const club = nearestClubName(r.club, bag, playsLike) ?? bag[0]?.name ?? '';
  let alternateClub = '';
  if (s(r.alternateClub)) {
    const rest = bag.filter((c) => c.name !== club);
    alternateClub = nearestClubName(r.alternateClub, rest, playsLike) ?? '';
  }

  const t = r.target && typeof r.target === 'object' ? r.target : {};
  const aimSide = toEnum(t.aimSide, AIM_SIDES) ?? 'center';
  const aimOffsetYds = aimSide === 'center' ? 0 : roundIn(t.aimOffsetYds, -60, 60, 0);

  const risk = r.risk && typeof r.risk === 'object' ? r.risk : {};
  return {
    club,
    alternateClub,
    shotType: toEnum(r.shotType, SHOT_TYPES) ?? 'full',
    target: { description: s(t.description), aimSide, aimOffsetYds },
    carryNeededYds: carry,
    playsLikeYds: playsLike,
    playsLikeNotes: noAdjust ? [] : strList(r.playsLikeNotes),
    hazardsInPlay: (Array.isArray(r.hazardsInPlay) ? r.hazardsInPlay : [])
      // deno-lint-ignore no-explicit-any
      .map((h: any) => ({ hazard: s(h?.hazard), note: s(h?.note) }))
      .filter((h: { hazard: string }) => h.hazard)
      .slice(0, MAX_ITEMS),
    risk: { level: toEnum(risk.level, RISK_LEVELS) ?? 'medium', bailout: s(risk.bailout), notes: s(risk.notes) },
    why: strList(r.why),
  };
}
