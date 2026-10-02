// Pure parser: Overpass `out geom` elements for one golf course -> course_holes rows.
// No I/O here so it can be unit tested with fixtures (see __tests__/).
//
// OSM golf tagging reference: https://wiki.openstreetmap.org/wiki/Tag:leisure=golf_course
// golf=hole is a line drawn tee -> green with ref=<hole number>, par, handicap.

import {
  distanceBetweenShapes,
  distancePointToPolygon,
  haversineMeters,
  type LatLng,
  metersToYards,
  pointInPolygon,
  polygonAreaM2,
  polygonCentroid,
  polylineLengthMeters,
  rayPolygonIntersections,
  simplify,
  toLocal,
  vertexMean,
} from './geo.ts';
import type { OverpassElement } from './overpass.ts';

export type HazardKind = 'bunker' | 'water' | 'lateral_water' | 'ob';

export interface Hazard {
  id: string;
  kind: HazardKind;
  name: string | null;
  polygon: LatLng[];
}

/** Matches the course_holes columns written by replace_course_holes(). */
export interface CourseHoleRow {
  loop_key: string;
  hole_number: number;
  par: number | null;
  handicap: number | null;
  length_yds: number | null;
  hole_line: LatLng[] | null;
  tee_lat: number | null;
  tee_lng: number | null;
  green_center_lat: number | null;
  green_center_lng: number | null;
  green_front_lat: number | null;
  green_front_lng: number | null;
  green_back_lat: number | null;
  green_back_lng: number | null;
  green_polygon: LatLng[] | null;
  tees: LatLng[];
  fairways: LatLng[][];
  hazards: Hazard[];
  osm_way_id: number | null;
}

export interface UnassignedGreen {
  id: string;
  center: LatLng;
  polygon: LatLng[];
}

export type HoleDataStatus = 'ready' | 'partial' | 'none';

export interface ParsedCourse {
  holes: CourseHoleRow[];
  unassignedGreens: UnassignedGreen[];
  status: HoleDataStatus;
}

/** CourseHole as returned by course-detail (docs/gps-contracts.md). */
export interface CourseHole {
  hole_number: number;
  loop_key: string;
  par: number | null;
  handicap: number | null;
  length_yds: number | null;
  tee: LatLng | null;
  line: LatLng[] | null;
  green: {
    center: LatLng | null;
    front: LatLng | null;
    back: LatLng | null;
    polygon: LatLng[] | null;
  };
  hazards: Hazard[];
  source: 'osm';
}

// Tunables (meters).
const BOUNDARY_BUFFER_M = 30;
const GREEN_MATCH_M = 35;
const TEE_MATCH_M = 50;
const HAZARD_LINE_M = 40;
const HAZARD_GREEN_M = 25;
const FAIRWAY_LINE_M = 10;
const HAZARD_MAX_VERTICES = 60;
/** Minimum number of duplicated hole numbers before we infer separate loops (rule 7). */
const MIN_DUPLICATES_FOR_LOOPS = 3;

type Kind =
  | 'hole' | 'green' | 'tee' | 'fairway' | 'bunker' | 'water_hazard'
  | 'lateral_water_hazard' | 'water' | 'ob' | 'pin';

interface Feature {
  id: string;
  osmId: number;
  kind: Kind;
  tags: Record<string, string>;
  /** Polygon ring (open or closed) for areas; null for lines/points. */
  ring: LatLng[] | null;
  line: LatLng[] | null;
  point: LatLng | null;
  isGolf: boolean;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r6 = (p: LatLng): LatLng => [round6(p[0]), round6(p[1])];
const r6s = (pts: LatLng[]): LatLng[] => pts.map(r6);

function geomToPoints(geom: ({ lat: number; lon: number } | null)[] | undefined): LatLng[] {
  if (!geom) return [];
  return geom.filter((g): g is { lat: number; lon: number } => !!g).map((g) => [g.lat, g.lon]);
}

const samePoint = (a: LatLng, b: LatLng) => a[0] === b[0] && a[1] === b[1];

/** Joins multipolygon member ways end-to-end into rings. Unclosable chains are kept if >= 3 points. */
export function assembleRings(ways: LatLng[][]): LatLng[][] {
  const pending = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings: LatLng[][] = [];
  while (pending.length) {
    let cur = pending.shift()!;
    while (!(cur.length >= 4 && samePoint(cur[0], cur[cur.length - 1]))) {
      const last = cur[cur.length - 1];
      const idx = pending.findIndex((w) => samePoint(w[0], last) || samePoint(w[w.length - 1], last));
      if (idx === -1) break;
      const next = pending.splice(idx, 1)[0];
      const oriented = samePoint(next[0], last) ? next : next.slice().reverse();
      cur = cur.concat(oriented.slice(1));
    }
    if (cur.length >= 3) rings.push(cur);
  }
  return rings;
}

/** Outer rings of a way / multipolygon relation element (null for nodes or empty geometry). */
export function boundaryFromElement(el: OverpassElement | undefined | null): LatLng[][] | null {
  if (!el) return null;
  if (el.type === 'way') {
    const pts = geomToPoints(el.geometry);
    return pts.length >= 3 ? [pts] : null;
  }
  if (el.type === 'relation') {
    const rings = outerRings(el);
    return rings.length ? rings : null;
  }
  return null;
}

function outerRings(el: OverpassElement): LatLng[][] {
  const ways = (el.members ?? [])
    .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === ''))
    .map((m) => geomToPoints(m.geometry));
  return assembleRings(ways);
}

function classify(tags: Record<string, string>): { kind: Kind; isGolf: boolean } | null {
  switch (tags.golf) {
    case 'hole': return { kind: 'hole', isGolf: true };
    case 'green': return { kind: 'green', isGolf: true };
    case 'tee': return { kind: 'tee', isGolf: true };
    case 'fairway': return { kind: 'fairway', isGolf: true };
    case 'bunker': return { kind: 'bunker', isGolf: true };
    case 'water_hazard': return { kind: 'water_hazard', isGolf: true };
    case 'lateral_water_hazard': return { kind: 'lateral_water_hazard', isGolf: true };
    case 'out_of_bounds': return { kind: 'ob', isGolf: true };
    case 'pin': return { kind: 'pin', isGolf: true };
  }
  if (tags.natural === 'water') return { kind: 'water', isGolf: false };
  return null;
}

function extractFeatures(elements: OverpassElement[], skip: Set<string>): Feature[] {
  const out: Feature[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const c = classify(tags);
    if (!c) continue;
    const prefix = el.type === 'node' ? 'n' : el.type === 'way' ? 'w' : 'r';
    const id = `${prefix}${el.id}`;
    if (skip.has(id)) continue;
    const base = { osmId: el.id, kind: c.kind, tags, isGolf: c.isGolf };

    if (el.type === 'node') {
      if ((c.kind === 'pin' || c.kind === 'tee') && typeof el.lat === 'number' && typeof el.lon === 'number') {
        out.push({ ...base, id, ring: null, line: null, point: [el.lat, el.lon] });
      }
      continue;
    }
    if (c.kind === 'pin') continue;

    if (el.type === 'way') {
      const pts = geomToPoints(el.geometry);
      if (c.kind === 'hole' || c.kind === 'ob') {
        if (pts.length >= 2) out.push({ ...base, id, ring: null, line: pts, point: null });
      } else if (pts.length >= 3) {
        out.push({ ...base, id, ring: pts, line: null, point: null });
      }
      continue;
    }

    // Relation: multipolygon areas only; take the outer rings, one feature per ring.
    if (c.kind === 'hole' || c.kind === 'ob') continue;
    outerRings(el).forEach((ring, i) => {
      out.push({ ...base, id: i === 0 ? id : `${id}-${i + 1}`, ring, line: null, point: null });
    });
  }
  return out;
}

function refPoint(f: Feature): LatLng {
  if (f.point) return f.point;
  if (f.ring) return polygonCentroid(f.ring);
  return vertexMean(f.line!);
}

function insideBoundary(p: LatLng, boundary: LatLng[][]): boolean {
  return boundary.some((ring) => pointInPolygon(p, ring) || distancePointToPolygon(p, ring) <= BOUNDARY_BUFFER_M);
}

/** Simplifies with increasing tolerance until the shape has at most maxVertices points. */
function simplifyCapped(pts: LatLng[], toleranceM: number, maxVertices: number): LatLng[] {
  let tol = toleranceM;
  let s = simplify(pts, tol);
  while (s.length > maxVertices && tol < 1000) {
    tol *= 2;
    s = simplify(pts, tol);
  }
  return r6s(s);
}

function parseIntTag(v: string | undefined, min: number, max: number): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

interface HoleCandidate {
  row: CourseHoleRow;
  osmId: number;
  mid: LatLng;
  hasGreen: boolean;
  hasExplicitLoop: boolean;
}

/**
 * Parses golf features for one course.
 * @param elements Overpass elements (`out geom`), may include the course boundary element itself.
 * @param boundary Course outer rings, or null when unknown (no boundary filtering then).
 * @param boundaryId Optional 'w123'/'r123' of the boundary element so it isn't treated as a feature.
 */
export function parseGolfFeatures(
  elements: OverpassElement[],
  boundary: LatLng[][] | null,
  boundaryId?: string,
): ParsedCourse {
  const skip = new Set<string>(boundaryId ? [boundaryId] : []);
  let features = extractFeatures(elements, skip);

  // Rule 1: keep golf features inside the boundary (+~30 m). natural=water is exempt: a lake
  // whose centroid lies outside the course can still border a hole; rule 5's distance test
  // keeps only water near a hole.
  if (boundary && boundary.length) {
    features = features.filter((f) => !f.isGolf || insideBoundary(refPoint(f), boundary));
  }

  const greens = features.filter((f) => f.kind === 'green' && f.ring);
  const tees = features.filter((f) => f.kind === 'tee');
  const pins = features.filter((f) => f.kind === 'pin' && f.point);
  const fairways = features.filter((f) => f.kind === 'fairway' && f.ring);
  const hazardFeatures = features.filter((f) =>
    (f.ring && ['bunker', 'water_hazard', 'lateral_water_hazard', 'water'].includes(f.kind)) ||
    (f.kind === 'ob' && f.line)
  );
  const matchedGreens = new Set<string>();
  const candidates: HoleCandidate[] = [];

  for (const f of features) {
    if (f.kind !== 'hole' || !f.line) continue;
    // Rule 2
    const holeNumber = parseIntTag(f.tags.ref, 1, 36);
    if (holeNumber === null) continue;
    const loopName = (f.tags['golf:course:name'] ?? '').trim();

    let line = f.line.slice();
    if (greens.length) {
      const dist = (p: LatLng) => Math.min(...greens.map((g) => distancePointToPolygon(p, g.ring!)));
      if (dist(line[0]) < dist(line[line.length - 1])) line = line.reverse();
    }
    const start = line[0];
    const end = line[line.length - 1];

    // Rule 3: green containing the end point, else the nearest within 35 m.
    let green: Feature | null = null;
    const containing = greens.filter((g) => pointInPolygon(end, g.ring!));
    if (containing.length) {
      green = containing.reduce((a, b) => (polygonAreaM2(a.ring!) <= polygonAreaM2(b.ring!) ? a : b));
    } else {
      let best = Infinity;
      for (const g of greens) {
        const d = distancePointToPolygon(end, g.ring!);
        if (d <= GREEN_MATCH_M && d < best) {
          best = d;
          green = g;
        }
      }
    }

    let center: LatLng = end;
    let front: LatLng | null = null;
    let back: LatLng | null = null;
    let greenPolygon: LatLng[] | null = null;
    if (green) {
      matchedGreens.add(green.id);
      const ring = green.ring!;
      const pin = pins.find((p) => pointInPolygon(p.point!, ring));
      center = pin ? pin.point! : polygonCentroid(ring);
      if (line.length >= 2) {
        const hits = rayPolygonIntersections(line[line.length - 2], center, ring);
        if (hits.length >= 2) {
          front = hits[0].point;
          back = hits[hits.length - 1].point;
        } else if (hits.length === 1) {
          back = hits[0].point; // ray origin was inside the green
        }
      }
      greenPolygon = simplifyCapped(ring, 0.5, 80);
    }

    // Rule 4: tees near the start; the one farthest from the green is the hole's tee.
    const teePoints = tees
      .filter((t) => (t.ring ? distancePointToPolygon(start, t.ring) : haversineMeters(start, t.point!)) <= TEE_MATCH_M)
      .map(refPoint);
    let tee: LatLng = start;
    if (teePoints.length) {
      tee = teePoints.reduce((a, b) => (haversineMeters(a, center) >= haversineMeters(b, center) ? a : b));
    }

    // Rule 5: hazards near the hole line or the green.
    const hazards: Hazard[] = [];
    for (const h of hazardFeatures) {
      if (h.kind === 'ob') {
        if (distanceBetweenShapes(h.line!, false, line, false) <= HAZARD_LINE_M) {
          hazards.push({ id: h.id, kind: 'ob', name: h.tags.name ?? null, polygon: simplifyCapped(h.line!, 1, HAZARD_MAX_VERTICES) });
        }
        continue;
      }
      const ring = h.ring!;
      const near = distanceBetweenShapes(ring, true, line, false) <= HAZARD_LINE_M ||
        (green !== null && distanceBetweenShapes(ring, true, green.ring!, true) <= HAZARD_GREEN_M);
      if (!near) continue;
      const kind: HazardKind = h.kind === 'bunker' ? 'bunker' : h.kind === 'lateral_water_hazard' ? 'lateral_water' : 'water';
      hazards.push({ id: h.id, kind, name: h.tags.name ?? null, polygon: simplifyCapped(ring, 1, HAZARD_MAX_VERTICES) });
    }

    const holeFairways = fairways
      .filter((fw) => distanceBetweenShapes(fw.ring!, true, line, false) <= FAIRWAY_LINE_M)
      .map((fw) => simplifyCapped(fw.ring!, 2, 80));

    // Length from the drawn line (the OSM `dist` tag is ignored: often missing or stale).
    const lengthYds = Math.round(metersToYards(polylineLengthMeters(line)));

    candidates.push({
      osmId: f.osmId,
      mid: vertexMean(line),
      hasGreen: green !== null,
      hasExplicitLoop: loopName !== '',
      row: {
        loop_key: loopName,
        hole_number: holeNumber,
        par: parseIntTag(f.tags.par, 3, 6),
        handicap: parseIntTag(f.tags.handicap, 1, 36),
        length_yds: lengthYds >= 30 && lengthYds <= 800 ? lengthYds : null,
        hole_line: r6s(line),
        tee_lat: round6(tee[0]),
        tee_lng: round6(tee[1]),
        green_center_lat: round6(center[0]),
        green_center_lng: round6(center[1]),
        green_front_lat: front ? round6(front[0]) : null,
        green_front_lng: front ? round6(front[1]) : null,
        green_back_lat: back ? round6(back[0]) : null,
        green_back_lng: back ? round6(back[1]) : null,
        green_polygon: greenPolygon,
        tees: r6s(teePoints),
        fairways: holeFairways,
        hazards,
        osm_way_id: f.osmId,
      },
    });
  }

  assignInferredLoops(candidates);

  // One row per (loop_key, hole_number): prefer a hole with a green, then the lowest OSM id.
  const byKey = new Map<string, HoleCandidate>();
  for (const c of candidates) {
    const key = `${c.row.loop_key}\u0000${c.row.hole_number}`;
    const prev = byKey.get(key);
    if (!prev || (c.hasGreen && !prev.hasGreen) || (c.hasGreen === prev.hasGreen && c.osmId < prev.osmId)) {
      byKey.set(key, c);
    }
  }
  const holes = [...byKey.values()]
    .map((c) => c.row)
    .sort((a, b) => a.loop_key.localeCompare(b.loop_key) || a.hole_number - b.hole_number);

  // Rule 6
  const unassignedGreens: UnassignedGreen[] = greens
    .filter((g) => !matchedGreens.has(g.id))
    .map((g) => ({ id: g.id, center: r6(polygonCentroid(g.ring!)), polygon: simplifyCapped(g.ring!, 0.5, 80) }));

  // Rule 8
  const holesWithGreen = holes.filter((h) => h.green_polygon !== null).length;
  const status: HoleDataStatus = holesWithGreen >= 9
    ? 'ready'
    : holes.length >= 1 || greens.length >= 1
    ? 'partial'
    : 'none';

  return { holes, unassignedGreens, status };
}

/**
 * Rule 7: courses with several loops (e.g. 27 holes as three nines all numbered 1-9) often
 * map hole numbers more than once without golf:course:name. When at least
 * MIN_DUPLICATES_FOR_LOOPS hole numbers repeat among unlabeled holes, cluster those holes
 * spatially into k loops (k = highest repeat count) using k-means on hole midpoints, seeded
 * with the instances of the most-repeated hole number, and label them 'A', 'B', ... in seed
 * OSM-id order. One or two stray duplicates are treated as mapping errors and deduplicated
 * instead. This is a heuristic: interleaved loops can be split imperfectly.
 */
function assignInferredLoops(candidates: HoleCandidate[]) {
  const unlabeled = candidates.filter((c) => !c.hasExplicitLoop);
  const byNumber = new Map<number, HoleCandidate[]>();
  for (const c of unlabeled) {
    const list = byNumber.get(c.row.hole_number) ?? [];
    list.push(c);
    byNumber.set(c.row.hole_number, list);
  }
  const duplicated = [...byNumber.entries()].filter(([, l]) => l.length > 1);
  if (duplicated.length < MIN_DUPLICATES_FOR_LOOPS) return;

  const k = Math.max(...duplicated.map(([, l]) => l.length));
  const seedGroup = duplicated
    .filter(([, l]) => l.length === k)
    .sort((a, b) => a[0] - b[0])[0][1]
    .slice()
    .sort((a, b) => a.osmId - b.osmId);

  const proj = toLocal(vertexMean(unlabeled.map((c) => c.mid)));
  const pts = unlabeled.map((c) => proj.project(c.mid));
  let centroids = seedGroup.map((c) => proj.project(c.mid));
  let assign = new Array<number>(unlabeled.length).fill(0);

  for (let iter = 0; iter < 20; iter++) {
    const next = pts.map((p) => {
      let best = 0, bestD = Infinity;
      centroids.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    });
    // Seeds stay in their own cluster so labels remain stable.
    seedGroup.forEach((s, i) => (next[unlabeled.indexOf(s)] = i));
    const changed = next.some((v, i) => v !== assign[i]);
    assign = next;
    centroids = centroids.map((c, i) => {
      const members = pts.filter((_, j) => assign[j] === i);
      if (!members.length) return c;
      return [
        members.reduce((s, p) => s + p[0], 0) / members.length,
        members.reduce((s, p) => s + p[1], 0) / members.length,
      ];
    });
    if (!changed && iter > 0) break;
  }

  unlabeled.forEach((c, i) => {
    c.row.loop_key = String.fromCharCode(65 + assign[i]); // 'A', 'B', ...
  });
}

const pair = (lat: number | null, lng: number | null): LatLng | null =>
  lat !== null && lng !== null && lat !== undefined && lng !== undefined ? [lat, lng] : null;

/** Maps a course_holes DB row to the CourseHole contract. */
export function rowToCourseHole(row: Partial<CourseHoleRow> & { hole_number: number }): CourseHole {
  return {
    hole_number: row.hole_number,
    loop_key: row.loop_key ?? '',
    par: row.par ?? null,
    handicap: row.handicap ?? null,
    length_yds: row.length_yds ?? null,
    tee: pair(row.tee_lat ?? null, row.tee_lng ?? null),
    line: row.hole_line ?? null,
    green: {
      center: pair(row.green_center_lat ?? null, row.green_center_lng ?? null),
      front: pair(row.green_front_lat ?? null, row.green_front_lng ?? null),
      back: pair(row.green_back_lat ?? null, row.green_back_lng ?? null),
      polygon: row.green_polygon ?? null,
    },
    hazards: Array.isArray(row.hazards) ? row.hazards : [],
    source: 'osm',
  };
}
