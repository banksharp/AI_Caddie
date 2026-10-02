import {
  haversineMeters,
  metersToYards,
  yardsBetween,
  bearingDeg,
  destinationPoint,
  toLocal,
  polygonCentroid,
  pointInPolygon,
  distancePointToSegment,
  distancePointToPolyline,
  polylineLengthMeters,
  rayPolygonIntersections,
  greenDistances,
  hazardDistances,
  hazardsForShot,
  distanceSummary,
  isNearCourse,
  gpsQuality,
} from '../distance';

const ORIGIN = [32.9, -117.25];
const L = toLocal(ORIGIN);
const at = (x, y) => L.unproject({ x, y }); // local metres -> [lat,lng]
const rect = (x0, y0, x1, y1) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
const yd = (m) => Math.round(m / 0.9144);

describe('haversine and basics', () => {
  test('one degree of latitude', () => {
    expect(haversineMeters([0, 0], [1, 0])).toBeCloseTo(111195.08, 1);
    expect(haversineMeters([0, 0], [0, 1])).toBeCloseTo(111195.08, 1);
  });
  test('London to Paris ~343.5 km', () => {
    const d = haversineMeters([51.5074, -0.1278], [48.8566, 2.3522]);
    expect(d / 1000).toBeGreaterThan(343);
    expect(d / 1000).toBeLessThan(344.2);
  });
  test('LAX to JFK ~3974 km', () => {
    const d = haversineMeters([33.9416, -118.4085], [40.6413, -73.7781]);
    expect(Math.abs(d / 1000 - 3974)).toBeLessThan(5);
  });
  test('zero and invalid', () => {
    expect(haversineMeters(ORIGIN, ORIGIN)).toBe(0);
    expect(haversineMeters(null, ORIGIN)).toBeNull();
  });
  test('yards', () => {
    expect(metersToYards(0.9144)).toBeCloseTo(1, 10);
    expect(yardsBetween([0, 0], [1, 0])).toBeCloseTo(111195.08 / 0.9144, 0);
  });
  test('bearing and destination round-trip', () => {
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90, 6);
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(180, 6);
    const p = destinationPoint(ORIGIN, 37, 250);
    expect(haversineMeters(ORIGIN, p)).toBeCloseTo(250, 3);
    expect(bearingDeg(ORIGIN, p)).toBeCloseTo(37, 3);
  });
  test('local projection round-trip and accuracy', () => {
    const p = at(123.4, -56.7);
    const q = L.project(p);
    expect(q.x).toBeCloseTo(123.4, 6);
    expect(q.y).toBeCloseTo(-56.7, 6);
    expect(haversineMeters(ORIGIN, at(300, 400))).toBeCloseTo(500, 0);
  });
});

describe('polygons and lines', () => {
  const sq = rect(0, 0, 20, 20);
  test('centroid of square', () => {
    const c = L.project(polygonCentroid(sq));
    expect(c.x).toBeCloseTo(10, 3);
    expect(c.y).toBeCloseTo(10, 3);
  });
  test('centroid accepts a closed ring', () => {
    const c = L.project(polygonCentroid([...sq, sq[0]]));
    expect(c.x).toBeCloseTo(10, 3);
  });
  test('point in polygon', () => {
    expect(pointInPolygon(at(5, 5), sq)).toBe(true);
    expect(pointInPolygon(at(25, 5), sq)).toBe(false);
  });
  test('segment and polyline distances', () => {
    expect(distancePointToSegment(at(5, 10), at(0, 0), at(0, 20))).toBeCloseTo(5, 2);
    expect(distancePointToSegment(at(0, 30), at(0, 0), at(0, 20))).toBeCloseTo(10, 2);
    const line = [at(0, 0), at(0, 100), at(100, 100)];
    expect(distancePointToPolyline(at(50, 90), line)).toBeCloseTo(10, 2);
    expect(polylineLengthMeters(line)).toBeCloseTo(200, 1);
    expect(distancePointToPolyline(at(3, 4), [at(0, 0)])).toBeCloseTo(5, 2);
    expect(distancePointToPolyline(at(3, 4), [])).toBeNull();
  });
  test('ray intersections sorted by distance', () => {
    const hits = rayPolygonIntersections(ORIGIN, at(0, 1), rect(-10, 150, 10, 170));
    expect(hits).toHaveLength(2);
    expect(hits[0].distanceM).toBeCloseTo(150, 2);
    expect(hits[1].distanceM).toBeCloseTo(170, 2);
  });
  test('ray miss', () => {
    expect(rayPolygonIntersections(ORIGIN, at(0, 1), rect(50, 150, 70, 170))).toEqual([]);
    // polygon behind the golfer
    expect(rayPolygonIntersections(ORIGIN, at(0, 1), rect(-10, -170, 10, -150))).toEqual([]);
  });
  test('degenerate polygons', () => {
    expect(polygonCentroid([])).toBeNull();
    expect(polygonCentroid(null)).toBeNull();
    const one = L.project(polygonCentroid([at(5, 5)]));
    expect(one.x).toBeCloseTo(5, 3);
    const colinear = L.project(polygonCentroid([at(0, 0), at(10, 0), at(20, 0)]));
    expect(colinear.x).toBeCloseTo(10, 3);
    expect(pointInPolygon(at(0, 0), [at(0, 0), at(1, 1)])).toBe(false);
    expect(rayPolygonIntersections(ORIGIN, ORIGIN, rect(-10, 150, 10, 170))).toEqual([]);
    expect(rayPolygonIntersections(ORIGIN, at(0, 1), [])).toEqual([]);
  });
});

describe('greenDistances', () => {
  const polygon = rect(-10, 150, 10, 170);
  const center = at(0, 160);

  test('rectangular green head-on', () => {
    const r = greenDistances(ORIGIN, { center, polygon });
    expect(r.method).toBe('polygon');
    expect(r.front).toBe(yd(150));
    expect(r.center).toBe(yd(160));
    expect(r.back).toBe(yd(170));
  });

  test('rectangular green at 45 degrees', () => {
    const golfer = at(-160 / Math.SQRT2, 160 - 160 / Math.SQRT2);
    const r = greenDistances(golfer, { center, polygon });
    expect(r.method).toBe('polygon');
    expect(r.front).toBeLessThan(r.center);
    expect(r.center).toBeLessThan(r.back);
    const half = 10 * Math.SQRT2;
    expect(Math.abs(r.front - yd(160 - half))).toBeLessThanOrEqual(1);
    expect(Math.abs(r.back - yd(160 + half))).toBeLessThanOrEqual(1);
  });

  test('golfer on the green: front is 0', () => {
    const r = greenDistances(at(0, 155), { center, polygon });
    expect(r.front).toBe(0);
    expect(r.back).toBe(yd(15));
  });

  test('stored front/back when no polygon', () => {
    const r = greenDistances(ORIGIN, { center, front: at(0, 148), back: at(0, 172), polygon: null });
    expect(r).toEqual({ front: yd(148), center: yd(160), back: yd(172), method: 'stored' });
  });

  test('falls back to stored when ray misses polygon', () => {
    const r = greenDistances(ORIGIN, {
      center,
      front: at(0, 150),
      back: at(0, 170),
      polygon: rect(50, 150, 70, 170),
    });
    expect(r.method).toBe('stored');
  });

  test('center only', () => {
    const r = greenDistances(ORIGIN, { center, polygon: [at(0, 1), at(0, 2)] });
    expect(r).toEqual({ front: null, center: yd(160), back: null, method: 'centerOnly' });
  });

  test('null center gives all null', () => {
    const r = greenDistances(ORIGIN, { center: null, polygon });
    expect(r.front).toBeNull();
    expect(r.center).toBeNull();
    expect(r.back).toBeNull();
    expect(greenDistances(ORIGIN, null).center).toBeNull();
    expect(greenDistances(null, { center }).center).toBeNull();
  });
});

describe('hazardDistances', () => {
  const target = at(0, 200);

  test('bunker straddling the line', () => {
    const h = hazardDistances(ORIGIN, target, { id: 'b1', kind: 'bunker', polygon: rect(-5, 100, 5, 115) });
    expect(h).toMatchObject({ id: 'b1', kind: 'bunker', inPlay: true, side: 'center', lateralYds: 0 });
    expect(h.reachYds).toBe(yd(100));
    expect(h.carryYds).toBe(yd(115));
    expect(h.distanceYds).toBe(yd(100));
  });

  test('water left inside the corridor', () => {
    const h = hazardDistances(ORIGIN, target, { id: 'w', kind: 'water', polygon: rect(-20, 120, -10, 130) });
    expect(h.inPlay).toBe(true);
    expect(h.side).toBe('left');
    expect(h.lateralYds).toBe(yd(10));
  });

  test('hazard partly in the corridor reports only the in-corridor part', () => {
    // corridor is 25 yds = 22.86 m; hazard spans x 15..60
    const h = hazardDistances(ORIGIN, target, { id: 'w', kind: 'water', polygon: rect(15, 140, 60, 160) });
    expect(h.inPlay).toBe(true);
    expect(h.side).toBe('right');
    expect(h.reachYds).toBe(yd(140));
    expect(h.carryYds).toBe(yd(160));
  });

  test('bunker outside the corridor', () => {
    const h = hazardDistances(ORIGIN, target, { id: 'b2', kind: 'bunker', polygon: rect(40, 180, 50, 190) });
    expect(h.inPlay).toBe(false);
    expect(h.reachYds).toBeNull();
    expect(h.carryYds).toBeNull();
    expect(h.side).toBe('right');
    expect(h.lateralYds).toBe(yd(40));
    expect(h.distanceYds).toBe(yd(Math.hypot(40, 180)));
  });

  test('corridor width option', () => {
    const poly = rect(40, 180, 50, 190);
    expect(hazardDistances(ORIGIN, target, { polygon: poly }, { corridorYds: 50 }).inPlay).toBe(true);
  });

  test('beyond the green and behind the golfer are not in play', () => {
    const past = hazardDistances(ORIGIN, target, { polygon: rect(-5, 240, 5, 260) });
    expect(past.inPlay).toBe(false);
    const behind = hazardDistances(ORIGIN, target, { polygon: rect(-5, -30, 5, -20) });
    expect(behind.inPlay).toBe(false);
    expect(behind.distanceYds).toBe(yd(20));
  });

  test('rotated frame: target due east, hazard to the south is right', () => {
    const h = hazardDistances(ORIGIN, at(200, 0), { polygon: rect(100, -15, 110, -10) });
    expect(h.inPlay).toBe(true);
    expect(h.side).toBe('right');
  });

  test('degenerate hazards', () => {
    expect(hazardDistances(ORIGIN, target, { id: 'x', polygon: [] })).toMatchObject({ id: 'x', inPlay: false, distanceYds: null });
    const pt = hazardDistances(ORIGIN, target, { polygon: [at(0, 50)] });
    expect(pt.inPlay).toBe(true);
    expect(pt.reachYds).toBe(yd(50));
    const noTarget = hazardDistances(ORIGIN, null, { polygon: rect(-5, 100, 5, 115) });
    expect(noTarget.inPlay).toBe(false);
    expect(noTarget.distanceYds).toBe(yd(100));
  });
});

describe('hazardsForShot and distanceSummary', () => {
  const target = at(0, 200);
  const many = Array.from({ length: 10 }, (_, i) => ({
    id: `o${i}`,
    kind: 'bunker',
    polygon: rect(60, 20 * i, 70, 20 * i + 5),
  }));

  test('in play first, then by reach, max 8', () => {
    const list = hazardsForShot(ORIGIN, target, [
      ...many,
      { id: 'far', kind: 'water', polygon: rect(-5, 150, 5, 160) },
      { id: 'near', kind: 'bunker', polygon: rect(-5, 90, 5, 100) },
      { id: 'bad', polygon: null },
    ]);
    expect(list).toHaveLength(8);
    expect(list[0].id).toBe('near');
    expect(list[1].id).toBe('far');
    expect(list.slice(2).every((h) => !h.inPlay)).toBe(true);
  });

  test('distanceSummary', () => {
    const hole = {
      hole_number: 1,
      green: { center: at(0, 160), polygon: rect(-10, 150, 10, 170) },
      hazards: [{ id: 'b', kind: 'bunker', polygon: rect(-5, 100, 5, 115) }],
    };
    const s = distanceSummary(ORIGIN, hole);
    expect(s.green.method).toBe('polygon');
    expect(s.hazards).toHaveLength(1);
    expect(s.hazards[0].inPlay).toBe(true);
  });

  test('distanceSummary without green uses end of line as target', () => {
    const s = distanceSummary(ORIGIN, {
      green: { center: null },
      line: [ORIGIN, at(0, 200)],
      hazards: [{ id: 'b', polygon: rect(-5, 100, 5, 115) }],
    });
    expect(s.green.center).toBeNull();
    expect(s.hazards[0].inPlay).toBe(true);
  });

  test('distanceSummary with nothing', () => {
    expect(distanceSummary(null, null)).toEqual({
      green: { front: null, center: null, back: null, method: 'centerOnly' },
      hazards: [],
    });
  });
});

describe('isNearCourse and gpsQuality', () => {
  const course = {
    center_lat: ORIGIN[0],
    center_lng: ORIGIN[1],
    bbox_south: at(0, -5000)[0],
    bbox_north: at(0, 500)[0],
    bbox_west: at(-500, 0)[1],
    bbox_east: at(500, 0)[1],
  };
  test('near course', () => {
    expect(isNearCourse(at(1500, 0), course)).toBe(true); // within 2 km
    expect(isNearCourse(at(0, -4000), course)).toBe(true); // inside bbox
    expect(isNearCourse(at(3000, 0), course)).toBe(false);
    expect(isNearCourse(null, course)).toBe(false);
    expect(isNearCourse(at(10, 10), { center_lat: null, center_lng: null })).toBe(false);
  });
  test('gps quality', () => {
    expect(gpsQuality(5, 1000)).toBe('good');
    expect(gpsQuality(8, 9999)).toBe('good');
    expect(gpsQuality(5, 12000)).toBe('fair');
    expect(gpsQuality(15, 1000)).toBe('fair');
    expect(gpsQuality(25, 1000)).toBe('poor');
    expect(gpsQuality(5, 60000)).toBe('poor');
    expect(gpsQuality(null, 0)).toBe('poor');
  });
});
