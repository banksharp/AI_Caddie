import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';
import {
  bearingDeg, distanceBetweenShapes, distancePointToPolyline, distancePointToSegment, haversineMeters,
  type LatLng, metersToYards, pointInPolygon, polygonCentroid, polylineLengthMeters, rayPolygonIntersections,
  simplify, toLocal,
} from '../geo.ts';

const P = toLocal([33, -117]);
const at = (x: number, y: number) => P.unproject([x, y]);
const square = (cx: number, cy: number, h: number): LatLng[] =>
  [at(cx - h, cy - h), at(cx + h, cy - h), at(cx + h, cy + h), at(cx - h, cy + h)];

Deno.test('haversine: one degree of latitude ~ 111.2 km', () => {
  assertAlmostEquals(haversineMeters([0, 0], [1, 0]), 111_195, 5);
  assertEquals(haversineMeters([33, -117], [33, -117]), 0);
});

Deno.test('metersToYards', () => {
  assertAlmostEquals(metersToYards(91.44), 100, 1e-9);
});

Deno.test('bearingDeg cardinal directions', () => {
  assertAlmostEquals(bearingDeg([0, 0], [1, 0]), 0, 1e-9);
  assertAlmostEquals(bearingDeg([0, 0], [0, 1]), 90, 1e-9);
  assertAlmostEquals(bearingDeg([0, 0], [-1, 0]), 180, 1e-9);
  assertAlmostEquals(bearingDeg([0, 0], [0, -1]), 270, 1e-9);
});

Deno.test('toLocal round trip and agreement with haversine', () => {
  const p = at(300, -400);
  const [x, y] = P.project(p);
  assertAlmostEquals(x, 300, 1e-6);
  assertAlmostEquals(y, -400, 1e-6);
  assertAlmostEquals(haversineMeters([33, -117], p), 500, 0.5);
});

Deno.test('polygonCentroid is area weighted', () => {
  const c = polygonCentroid(square(100, 50, 10));
  const [x, y] = P.project(c);
  assertAlmostEquals(x, 100, 1e-3);
  assertAlmostEquals(y, 50, 1e-3);
  // L-shape: a vertex mean would be biased toward the extra vertices.
  const L: LatLng[] = [at(0, 0), at(20, 0), at(20, 10), at(10, 10), at(10, 30), at(0, 30)];
  const [lx, ly] = P.project(polygonCentroid(L));
  // Areas: 20x10 at (10,5) and 10x20 at (5,20) -> (7.5, 12.5)
  assertAlmostEquals(lx, 7.5, 1e-3);
  assertAlmostEquals(ly, 12.5, 1e-3);
});

Deno.test('pointInPolygon', () => {
  const sq = square(0, 0, 10);
  assert(pointInPolygon(at(0, 0), sq));
  assert(!pointInPolygon(at(11, 0), sq));
  assert(pointInPolygon(at(9, 9), [...sq, sq[0]])); // closed ring works too
});

Deno.test('distances to segment / polyline / shapes', () => {
  assertAlmostEquals(distancePointToSegment(at(5, 10), at(0, 0), at(10, 0)), 10, 1e-3);
  assertAlmostEquals(distancePointToSegment(at(-3, 4), at(0, 0), at(10, 0)), 5, 1e-3);
  assertAlmostEquals(distancePointToPolyline(at(25, 5), [at(0, 0), at(20, 0), at(20, 20)]), 5, 1e-3);
  const sq = square(0, 0, 10);
  assertEquals(distanceBetweenShapes(sq, true, [at(-50, 0), at(50, 0)], false), 0); // crosses
  assertEquals(distanceBetweenShapes(sq, true, [at(0, 0), at(1, 1)], false), 0); // inside
  assertAlmostEquals(distanceBetweenShapes(sq, true, [at(30, -50), at(30, 50)], false), 20, 1e-3);
});

Deno.test('polylineLengthMeters', () => {
  assertAlmostEquals(polylineLengthMeters([at(0, 0), at(0, 300), at(400, 300)]), 700, 0.1);
});

Deno.test('rayPolygonIntersections gives front then back', () => {
  const hits = rayPolygonIntersections(at(0, -100), at(0, 0), square(0, 0, 10));
  assertEquals(hits.length, 2);
  assertAlmostEquals(hits[0].distance, 90, 1e-3);
  assertAlmostEquals(hits[1].distance, 110, 1e-3);
  assertEquals(rayPolygonIntersections(at(0, -100), at(0, -200), square(0, 0, 10)).length, 0);
});

Deno.test('simplify drops near-collinear points and keeps endpoints', () => {
  const line = [at(0, 0), at(10, 0.2), at(20, -0.2), at(30, 0), at(30, 30)];
  const s = simplify(line, 1);
  assertEquals(s.length, 3);
  assertEquals(s[0], line[0]);
  assertEquals(s[2], line[4]);
});
