// Small geodesy helpers for golf-course scale geometry. Coordinates are [lat, lng] in degrees.
// Planar operations use a local equirectangular projection (accurate to well under a meter
// over a few kilometers), which is all a golf hole needs.

export type LatLng = [number, number];
export type XY = [number, number]; // meters east, meters north

export const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * DEG;
  const dLng = (b[1] - a[1]) * DEG;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * DEG) * Math.cos(b[0] * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function metersToYards(m: number): number {
  return m / 0.9144;
}

/** Initial great-circle bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const f1 = a[0] * DEG;
  const f2 = b[0] * DEG;
  const dl = (b[1] - a[1]) * DEG;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Local equirectangular projection centered on `origin`. */
export function toLocal(origin: LatLng) {
  const ky = EARTH_RADIUS_M * DEG;
  const kx = ky * Math.cos(origin[0] * DEG);
  return {
    project(p: LatLng): XY {
      return [(p[1] - origin[1]) * kx, (p[0] - origin[0]) * ky];
    },
    unproject(xy: XY): LatLng {
      return [origin[0] + xy[1] / ky, origin[1] + (kx === 0 ? 0 : xy[0] / kx)];
    },
  };
}

function meanPoint(points: LatLng[]): LatLng {
  let lat = 0, lng = 0;
  for (const p of points) {
    lat += p[0];
    lng += p[1];
  }
  return [lat / points.length, lng / points.length];
}

/** Drops a closing vertex equal to the first one. */
function openRing(poly: LatLng[]): LatLng[] {
  if (poly.length > 1) {
    const a = poly[0], b = poly[poly.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return poly.slice(0, -1);
  }
  return poly;
}

/** Area-weighted centroid (computed in local meters). Degenerate polygons fall back to the vertex mean. */
export function polygonCentroid(polygon: LatLng[]): LatLng {
  const ring = openRing(polygon);
  if (ring.length === 0) throw new Error('empty polygon');
  if (ring.length < 3) return meanPoint(ring);
  const proj = toLocal(meanPoint(ring));
  const pts = ring.map(proj.project);
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a2) < 1e-6) return meanPoint(ring);
  return proj.unproject([cx / (3 * a2), cy / (3 * a2)]);
}

/** Polygon area in square meters. */
export function polygonAreaM2(polygon: LatLng[]): number {
  const ring = openRing(polygon);
  if (ring.length < 3) return 0;
  const proj = toLocal(meanPoint(ring));
  const pts = ring.map(proj.project);
  let a2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a2 += x0 * y1 - x1 * y0;
  }
  return Math.abs(a2) / 2;
}

/** Even-odd ray casting. */
export function pointInPolygon(pt: LatLng, polygon: LatLng[]): boolean {
  const ring = openRing(polygon);
  let inside = false;
  const [y, x] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDistXY(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance in meters from p to segment ab. */
export function distancePointToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const proj = toLocal(p);
  return segDistXY([0, 0], proj.project(a), proj.project(b));
}

/** Distance in meters from p to the nearest point of a polyline. */
export function distancePointToPolyline(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(p, line[0]);
  const proj = toLocal(p);
  const pts = line.map(proj.project);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, segDistXY([0, 0], pts[i], pts[i + 1]));
  return best;
}

/** Distance from p to a polygon: 0 inside, else distance to its boundary. */
export function distancePointToPolygon(p: LatLng, polygon: LatLng[]): number {
  if (polygon.length >= 3 && pointInPolygon(p, polygon)) return 0;
  return distancePointToPolyline(p, closeRing(polygon));
}

export function closeRing(polygon: LatLng[]): LatLng[] {
  const ring = openRing(polygon);
  return ring.length > 0 ? [...ring, ring[0]] : ring;
}

function segmentsIntersectXY(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Minimum distance in meters between two shapes. Closed shapes (polygons) count their
 * interior: a shape inside or crossing another is at distance 0.
 */
export function distanceBetweenShapes(
  a: LatLng[],
  aClosed: boolean,
  b: LatLng[],
  bClosed: boolean,
): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  if (aClosed && a.length >= 3 && b.some((p) => pointInPolygon(p, a))) return 0;
  if (bClosed && b.length >= 3 && a.some((p) => pointInPolygon(p, b))) return 0;
  const proj = toLocal(a[0]);
  const pa = (aClosed ? closeRing(a) : a).map(proj.project);
  const pb = (bClosed ? closeRing(b) : b).map(proj.project);
  for (let i = 0; i < pa.length - 1; i++) {
    for (let j = 0; j < pb.length - 1; j++) {
      if (segmentsIntersectXY(pa[i], pa[i + 1], pb[j], pb[j + 1])) return 0;
    }
  }
  const pointToLine = (p: XY, line: XY[]) => {
    if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1]);
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) best = Math.min(best, segDistXY(p, line[i], line[i + 1]));
    return best;
  };
  let best = Infinity;
  for (const p of pa) best = Math.min(best, pointToLine(p, pb));
  for (const p of pb) best = Math.min(best, pointToLine(p, pa));
  return best;
}

export function polylineLengthMeters(line: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += haversineMeters(line[i], line[i + 1]);
  return total;
}

/**
 * Intersections of the ray from `origin` through `through` with the polygon edges, sorted by
 * distance from origin (meters, > 0). Used for green front/back along the line of play.
 */
export function rayPolygonIntersections(
  origin: LatLng,
  through: LatLng,
  polygon: LatLng[],
): { point: LatLng; distance: number }[] {
  const proj = toLocal(origin);
  const d = proj.project(through);
  const dLen = Math.hypot(d[0], d[1]);
  if (dLen === 0) return [];
  const dir: XY = [d[0] / dLen, d[1] / dLen];
  const ring = closeRing(polygon).map(proj.project);
  const hits: { point: LatLng; distance: number }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const e: XY = [b[0] - a[0], b[1] - a[1]];
    const denom = dir[0] * e[1] - dir[1] * e[0];
    if (Math.abs(denom) < 1e-12) continue; // parallel
    // Solve origin + t*dir = a + u*e
    const t = (a[0] * e[1] - a[1] * e[0]) / denom;
    const u = (a[0] * dir[1] - a[1] * dir[0]) / denom;
    if (t > 1e-9 && u >= 0 && u <= 1) {
      hits.push({ point: proj.unproject([dir[0] * t, dir[1] * t]), distance: t });
    }
  }
  hits.sort((x, y) => x.distance - y.distance);
  // Drop duplicate hits where the ray passes exactly through a vertex.
  return hits.filter((h, i) => i === 0 || h.distance - hits[i - 1].distance > 1e-6);
}

/** Douglas–Peucker simplification with a tolerance in meters. Keeps endpoints. */
export function simplify(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2) return points.slice();
  const proj = toLocal(points[0]);
  const xy = points.map(proj.project);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const dd = segDistXY(xy[i], xy[s], xy[e]);
      if (dd > maxD) {
        maxD = dd;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Mean of the vertices (cheap reference point for lines). */
export function vertexMean(points: LatLng[]): LatLng {
  return meanPoint(points);
}
