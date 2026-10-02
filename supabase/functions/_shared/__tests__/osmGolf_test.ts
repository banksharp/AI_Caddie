import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import { assembleRings, boundaryFromElement, parseGolfFeatures, rowToCourseHole } from '../osmGolf.ts';
import { haversineMeters, type LatLng, toLocal } from '../geo.ts';
import type { OverpassElement } from '../overpass.ts';
import wellMapped from './fixtures/well_mapped_3_holes.json' with { type: 'json' };
import greensOnly from './fixtures/greens_only.json' with { type: 'json' };
import empty from './fixtures/empty.json' with { type: 'json' };
import duplicates from './fixtures/duplicate_hole_numbers.json' with { type: 'json' };

const P = toLocal([33, -117]);
const xy = (p: LatLng | null) => {
  const [x, y] = P.project(p!);
  return [Math.round(x), Math.round(y)];
};
const els = (f: { elements: unknown[] }) => f.elements as OverpassElement[];

function parseWellMapped() {
  const elements = els(wellMapped);
  const boundaryEl = elements.find((e) => e.id === 1000);
  return parseGolfFeatures(elements, boundaryFromElement(boundaryEl), 'w1000');
}

Deno.test('well-mapped course: three holes, partial status, unassigned practice green', () => {
  const r = parseWellMapped();
  assertEquals(r.status, 'partial'); // < 9 holes with greens
  assertEquals(r.holes.map((h) => h.hole_number), [1, 2, 3]); // ref "A" skipped
  assertEquals(r.holes.every((h) => h.loop_key === ''), true);
  assertEquals(r.unassignedGreens.map((g) => g.id), ['w204']); // w205 is outside the boundary
});

Deno.test('hole 1: pin overrides green center, farthest tee, hazards, fairway', () => {
  const h = parseWellMapped().holes[0];
  assertEquals(h.par, 4);
  assertEquals(h.handicap, 5);
  assertEquals(h.osm_way_id, 101);
  assertEquals(xy([h.green_center_lat!, h.green_center_lng!]), [25, 372]); // pin node 301
  assertEquals(xy([h.tee_lat!, h.tee_lng!]), [0, -10]); // tee 401 is farther from green than 402
  assertEquals(h.tees.length, 2);
  // Front/back on the green square x 5..35, y 355..385 along the ray from (0,200) through the pin.
  const [fx, fy] = xy([h.green_front_lat!, h.green_front_lng!]);
  const [bx, by] = xy([h.green_back_lat!, h.green_back_lng!]);
  assert(fy < 372 && by > 372, `front ${fx},${fy} back ${bx},${by}`);
  assertEquals(fy, 355);
  assertEquals(by, 385);
  const kinds = h.hazards.map((z) => `${z.id}:${z.kind}`).sort();
  assertEquals(kinds, ['r601:lateral_water', 'w501:bunker']); // natural=water w602 is far away
  assertEquals(h.hazards.find((z) => z.id === 'w501')!.name, 'Big Bertha');
  assertEquals(h.fairways.length, 1);
  // Length from the line: 200 m + hypot(20, 170) m.
  assertEquals(h.length_yds, Math.round((200 + Math.hypot(20, 170)) / 0.9144));
});

Deno.test('hole 2: reversed line is re-oriented tee -> green; OB within 40 m', () => {
  const h = parseWellMapped().holes[1];
  assertEquals(xy(h.hole_line![0]), [200, 250]);
  assertEquals(xy(h.hole_line![h.hole_line!.length - 1]), [200, 400]);
  assertEquals(xy([h.tee_lat!, h.tee_lng!]), [200, 250]); // no tee polygon -> line start
  assertEquals(h.tees, []);
  assertEquals(h.length_yds, Math.round(150 / 0.9144));
  assertEquals(h.hazards.map((z) => `${z.id}:${z.kind}`), ['w801:ob']);
});

Deno.test('hole 3: green matched by proximity (line ends short of it), dist tag ignored', () => {
  const h = parseWellMapped().holes[2];
  assertEquals(h.par, 5);
  assert(h.green_polygon !== null);
  assertEquals(xy([h.green_center_lat!, h.green_center_lng!]), [450, 505]);
  assert(h.green_front_lat !== null && h.green_back_lat !== null);
  const front: LatLng = [h.green_front_lat!, h.green_front_lng!];
  const back: LatLng = [h.green_back_lat!, h.green_back_lng!];
  const from = h.hole_line![1];
  assert(haversineMeters(from, front) < haversineMeters(from, back));
  assert(h.length_yds !== 999);
});

Deno.test('greens-only course: no holes, all greens unassigned, partial', () => {
  const r = parseGolfFeatures(els(greensOnly), null);
  assertEquals(r.holes, []);
  assertEquals(r.unassignedGreens.length, 3);
  assertEquals(r.status, 'partial');
  const c = xy(r.unassignedGreens.find((g) => g.id === 'w12')!.center);
  assertEquals(c, [300, 0]);
});

Deno.test('empty course: none', () => {
  const r = parseGolfFeatures(els(empty), null);
  assertEquals(r, { holes: [], unassignedGreens: [], status: 'none' });
});

Deno.test('duplicate hole numbers without loop tags are split into loops A and B', () => {
  const r = parseGolfFeatures(els(duplicates), null);
  assertEquals(r.holes.length, 6);
  const a = r.holes.filter((h) => h.loop_key === 'A');
  const b = r.holes.filter((h) => h.loop_key === 'B');
  assertEquals(a.map((h) => h.hole_number), [1, 2, 3]);
  assertEquals(b.map((h) => h.hole_number), [1, 2, 3]);
  // Loop A is seeded by the lower OSM id (1001..1003, at x 0..200).
  assertEquals(a.map((h) => h.osm_way_id), [1001, 1002, 1003]);
  assertEquals(b.map((h) => h.osm_way_id), [2001, 2002, 2003]);
  assertEquals(r.unassignedGreens, []);
});

Deno.test('a single stray duplicate is deduplicated, preferring the hole with a green', () => {
  const elements = [...els(wellMapped)];
  const stray = structuredClone(elements.find((e) => e.id === 101)!);
  stray.id = 50; // lower id, but far from any green
  stray.geometry = stray.geometry!.map((g) => g && ({ lat: g.lat - 0.002, lon: g.lon }));
  elements.push(stray);
  const r = parseGolfFeatures(elements, null);
  const ones = r.holes.filter((h) => h.hole_number === 1);
  assertEquals(ones.length, 1);
  assertEquals(ones[0].osm_way_id, 101);
  assertEquals(ones[0].loop_key, '');
});

Deno.test('explicit golf:course:name becomes loop_key', () => {
  const elements = els(wellMapped).map((e) =>
    e.id === 101 ? { ...e, tags: { ...e.tags, 'golf:course:name': 'North' } } : e
  );
  const r = parseGolfFeatures(elements, null);
  assertEquals(r.holes.find((h) => h.osm_way_id === 101)!.loop_key, 'North');
});

Deno.test('assembleRings joins split outer ways', () => {
  const rings = assembleRings([[[0, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1]]]);
  assertEquals(rings.length, 1);
  assertEquals(rings[0].length, 5);
  assertEquals(rings[0][0], rings[0][4]);
});

Deno.test('rowToCourseHole maps DB rows to the contract shape', () => {
  const row = parseWellMapped().holes[1];
  const hole = rowToCourseHole(row);
  assertEquals(hole.hole_number, 2);
  assertEquals(hole.loop_key, '');
  assertEquals(hole.source, 'osm');
  assertEquals(hole.tee, [row.tee_lat!, row.tee_lng!]);
  assertEquals(hole.line, row.hole_line);
  assertEquals(hole.green.polygon, row.green_polygon);
  assertEquals(Object.keys(hole).sort(), ['green', 'handicap', 'hazards', 'hole_number', 'length_yds', 'line', 'loop_key', 'par', 'source', 'tee']);
  const bare = rowToCourseHole({ hole_number: 4, tee_lat: null, tee_lng: null } as never);
  assertEquals(bare.tee, null);
  assertEquals(bare.green, { center: null, front: null, back: null, polygon: null });
  assertAlmostEquals(hole.length_yds!, 164, 0.5);
});
