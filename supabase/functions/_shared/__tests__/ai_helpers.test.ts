import { assertEquals, assert } from 'jsr:@std/assert@1';
import { bagFromClubs, clamp, nearestClubName, toEnum } from '../ai.ts';
import {
  buildPrompt, candidateClubs, candidateHint, hazardLine, normalizeAdvice, parseShotRequest,
} from '../../shot-recommendation/prompt.ts';

const CLUBS = {
  Driver: 250, '3-Wood': 225, '5-Iron': 180, '6-Iron': 168, '7-Iron': 155, '8-Iron': 145,
  '9-Iron': 133, PW: 120, SW: '90', LW: 0, Hybrid: 'n/a', Putter: -1,
};

Deno.test('toEnum matches case-insensitively and rejects others', () => {
  const allowed = ['flat', 'uphill', 'downhill'] as const;
  assertEquals(toEnum('Uphill ', allowed), 'uphill');
  assertEquals(toEnum('sideways', allowed), null);
  assertEquals(toEnum(3, allowed), null);
  assertEquals(toEnum(undefined, allowed), null);
});

Deno.test('clamp bounds values', () => {
  assertEquals(clamp(5, 1, 10), 5);
  assertEquals(clamp(-3, 1, 10), 1);
  assertEquals(clamp(99, 1, 10), 10);
  assertEquals(clamp(NaN, 1, 10), 1);
  assertEquals(clamp(-80, -60, 60), -60);
});

Deno.test('bagFromClubs drops bad distances and sorts longest first', () => {
  const bag = bagFromClubs(CLUBS);
  assertEquals(bag.map((c) => c.name), ['Driver', '3-Wood', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron', 'PW', 'SW']);
  assertEquals(bag.find((c) => c.name === 'SW')?.yds, 90);
  assertEquals(bagFromClubs({}), []);
  assertEquals(bagFromClubs(null), []);
});

Deno.test('nearestClubName prefers exact match, then nearest distance', () => {
  const bag = bagFromClubs(CLUBS);
  assertEquals(nearestClubName('7-iron', bag, 200), '7-Iron');
  assertEquals(nearestClubName('Seven iron', bag, 150), '7-Iron'); // tie (5 vs 5): the longer club wins
  assertEquals(nearestClubName('4-Iron', bag, 190), '5-Iron');
  assertEquals(nearestClubName('', bag, 95), 'SW');
  assertEquals(nearestClubName('Unknown', bag), null);
  assertEquals(nearestClubName('7-Iron', [], 150), null);
});

Deno.test('candidateClubs: clubs within ±12 yds, closest first, max 3', () => {
  const bag = bagFromClubs(CLUBS);
  assertEquals(candidateClubs(bag, 156).map((c) => c.name), ['7-Iron', '8-Iron', '6-Iron']);
  assertEquals(candidateClubs(bag, 162).map((c) => c.name), ['6-Iron', '7-Iron']);
});

Deno.test('candidateClubs: falls back to nearest two when fewer than two in window', () => {
  const bag = bagFromClubs(CLUBS);
  // Only Driver is within 12 of 245 → nearest two overall
  assertEquals(candidateClubs(bag, 245).map((c) => c.name), ['Driver', '3-Wood']);
  // Nothing within 12 of 40
  assertEquals(candidateClubs(bag, 40).map((c) => c.name), ['SW', 'PW']);
  assertEquals(candidateClubs([], 100), []);
});

Deno.test('candidateHint is labelled as a hint', () => {
  const hint = candidateHint(bagFromClubs(CLUBS), 156);
  assert(hint.startsWith('Hint'));
  assert(hint.includes('7-Iron (155)'));
  assertEquals(candidateHint([], 156), '');
});

Deno.test('hazardLine formats reach/carry', () => {
  assertEquals(
    hazardLine({ kind: 'water', side: 'right', reach_yds: 140, carry_yds: 162, lateral_yds: null, in_play: true }),
    'Water, right, 140 to reach / 162 to carry, in play',
  );
});

Deno.test('parseShotRequest validates per contract', () => {
  const good = {
    distance_to_pin_yds: 156, distance_to_front_yds: 148, distance_to_back_yds: 165,
    hole: { number: 7, par: 4, length_yds: 412 }, shot_number: 2, lie: 'fairway',
    wind: { direction: 'into', strength_mph: 10 }, elevation: 'flat',
    hazards: [{ kind: 'water', side: 'right', reach_yds: 140, carry_yds: 162, lateral_yds: 12, in_play: true }],
    gps_accuracy_yds: 4, source: 'osm',
  };
  const ok = parseShotRequest(good);
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.value.hazards.length, 1);

  assert(parseShotRequest({ distance_to_pin_yds: 156 }).ok);
  assertEquals(parseShotRequest({}).ok, false);
  assertEquals(parseShotRequest({ distance_to_pin_yds: 701 }).ok, false);
  assertEquals(parseShotRequest({ ...good, lie: 'cart_path' }).ok, false);
  assertEquals(parseShotRequest({ ...good, wind: { direction: 'into', strength_mph: 80 } }).ok, false);
  assertEquals(parseShotRequest({ ...good, hazards: Array(9).fill(good.hazards[0]) }).ok, false);
  assertEquals(parseShotRequest({ ...good, source: 'gps' }).ok, false);
  assertEquals(parseShotRequest([]).ok, false);
});

Deno.test('buildPrompt and normalizeAdvice enforce bag and ranges', () => {
  const bag = bagFromClubs(CLUBS);
  const parsed = parseShotRequest({ distance_to_pin_yds: 156 });
  assert(parsed.ok);
  if (!parsed.ok) return;
  const prompt = buildPrompt(parsed.value, bag);
  assert(prompt.indexOf('Driver') < prompt.indexOf('SW'));
  assert(prompt.includes('set playsLikeYds equal to carryNeededYds'));

  const out = normalizeAdvice({
    club: 'seven iron', alternateClub: '6-iron', shotType: 'blast',
    target: { description: 'Center', aimSide: 'left', aimOffsetYds: 200 },
    carryNeededYds: 2000, playsLikeYds: 170, playsLikeNotes: ['x'],
    hazardsInPlay: [], risk: { level: 'medium', bailout: 'Left', notes: '' },
    why: ['a', 'b', 'c', 'd', 'e', 'f'],
  }, bag, parsed.value);
  assertEquals(out.club, 'Driver'); // carry clamped to 750, nearest = Driver (no exact match)
  assertEquals(out.alternateClub, '6-Iron');
  assertEquals(out.shotType, 'full');
  assertEquals(out.target.aimOffsetYds, 60);
  assertEquals(out.carryNeededYds, 750);
  assertEquals(out.playsLikeYds, 750); // no wind/elevation → equals carry
  assertEquals(out.playsLikeNotes, []);
  assertEquals(out.why.length, 5);
});
