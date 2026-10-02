// Pure geometry helpers for GPS yardage. No React / native imports.
// Coordinates are always [lat, lng] arrays (see docs/gps-contracts.md).

export const EARTH_RADIUS_M = 6371008.8;
const M_PER_YD = 0.9144;
const DEG = Math.PI / 180;

const toRad = (d) => d * DEG;
const toDeg = (r) => r / DEG;

function isPoint(p) {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

// Drop invalid vertices and a repeated closing vertex.
function cleanPolygon(poly) {
  if (!Array.isArray(poly)) return [];
  const pts = poly.filter(isPoint);
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  return pts;
}

function roundYds(m) {
  return m == null || !Number.isFinite(m) ? null : Math.round(m / M_PER_YD);
}

// ---------------------------------------------------------------------------
// Basic distances

export function haversineMeters(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function metersToYards(m) {
  return m == null ? null : m / M_PER_YD;
}

export function yardsBetween(a, b) {
  return metersToYards(haversineMeters(a, b));
}

// Initial great-circle bearing a -> b, degrees clockwise from north, [0, 360).
export function bearingDeg(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  const φ1 = toRad(a[0]);
  const φ2 = toRad(b[0]);
  const Δλ = toRad(b[1] - a[1]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(start, bearing, distanceM) {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearing);
  const φ1 = toRad(start[0]);
  const λ1 = toRad(start[1]);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
}

// Local equirectangular projection around `origin` (x = east m, y = north m).
// Accurate to well under a metre over a golf hole.
export function toLocal(origin) {
  const lat0 = origin[0];
  const lng0 = origin[1];
  const kx = EARTH_RADIUS_M * DEG * Math.cos(toRad(lat0));
  const ky = EARTH_RADIUS_M * DEG;
  return {
    project: (p) => ({ x: (p[1] - lng0) * kx, y: (p[0] - lat0) * ky }),
    unproject: ({ x, y }) => [lat0 + y / ky, lng0 + x / kx],
  };
}

// ---------------------------------------------------------------------------
// Polygons and lines

export function polygonCentroid(poly) {
  const pts = cleanPolygon(poly);
  if (pts.length === 0) return null;
  const local = toLocal(pts[0]);
  const xy = pts.map(local.project);
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i];
    const q = xy[(i + 1) % xy.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-6) {
    // Degenerate (point, line, zero area): mean of vertices.
    const mx = xy.reduce((s, p) => s + p.x, 0) / xy.length;
    const my = xy.reduce((s, p) => s + p.y, 0) / xy.length;
    return local.unproject({ x: mx, y: my });
  }
  return local.unproject({ x: cx / (3 * a2), y: cy / (3 * a2) });
}

// Even-odd ray casting. Works on lat/lng directly (fine at golf-course scale).
export function pointInPolygon(point, poly) {
  const pts = cleanPolygon(poly);
  if (!isPoint(point) || pts.length < 3) return false;
  const [py, px] = point;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i];
    const [yj, xj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function segDistXY(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Metres from point p to segment a-b.
export function distancePointToSegment(p, a, b) {
  if (!isPoint(p) || !isPoint(a) || !isPoint(b)) return null;
  const local = toLocal(p);
  return segDistXY({ x: 0, y: 0 }, local.project(a), local.project(b));
}

// Metres from point p to the nearest point of a polyline. null if no points.
export function distancePointToPolyline(p, line) {
  if (!isPoint(p) || !Array.isArray(line)) return null;
  const pts = line.filter(isPoint);
  if (pts.length === 0) return null;
  if (pts.length === 1) return haversineMeters(p, pts[0]);
  const local = toLocal(p);
  const xy = pts.map(local.project);
  const o = { x: 0, y: 0 };
  let best = Infinity;
  for (let i = 0; i < xy.length - 1; i++) {
    best = Math.min(best, segDistXY(o, xy[i], xy[i + 1]));
  }
  return best;
}

export function polylineLengthMeters(line) {
  if (!Array.isArray(line)) return 0;
  const pts = line.filter(isPoint);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += haversineMeters(pts[i], pts[i + 1]);
  return total;
}

// Intersections of the ray starting at `origin` and passing through `through`
// with the polygon's edges. Returns [{ point:[lat,lng], distanceM }] sorted by
// distance from origin. Empty array if the ray misses or input is degenerate.
export function rayPolygonIntersections(origin, through, poly) {
  const pts = cleanPolygon(poly);
  if (!isPoint(origin) || !isPoint(through) || pts.length < 2) return [];
  const local = toLocal(origin);
  const t = local.project(through);
  const len = Math.hypot(t.x, t.y);
  if (len < 1e-6) return [];
  const ux = t.x / len;
  const uy = t.y / len;
  const xy = pts.map(local.project);
  const n = pts.length < 3 ? pts.length - 1 : pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = ux * ey - uy * ex; // cross(u, e)
    if (Math.abs(denom) < 1e-12) continue; // parallel
    // Solve origin + s*u = a + r*e
    const s = (a.x * ey - a.y * ex) / denom;
    const r = (a.x * uy - a.y * ux) / denom;
    if (s >= 0 && r >= 0 && r <= 1) {
      out.push({ s, x: ux * s, y: uy * s });
    }
  }
  out.sort((p, q) => p.s - q.s);
  // Drop duplicates where the ray passes exactly through a vertex.
  const dedup = [];
  for (const p of out) {
    if (!dedup.length || p.s - dedup[dedup.length - 1].s > 1e-3) dedup.push(p);
  }
  return dedup.map((p) => ({ point: local.unproject(p), distanceM: p.s }));
}

// ---------------------------------------------------------------------------
// Green and hazard yardages (integers in yards)

const NULL_GREEN = { front: null, center: null, back: null, method: 'centerOnly' };

export function greenDistances(golfer, green) {
  if (!isPoint(golfer) || !green || !isPoint(green.center)) return { ...NULL_GREEN };
  const centerM = haversineMeters(golfer, green.center);
  const center = roundYds(centerM);

  const poly = cleanPolygon(green.polygon);
  if (poly.length >= 3) {
    const hits = rayPolygonIntersections(golfer, green.center, poly);
    if (hits.length > 0) {
      const inside = pointInPolygon(golfer, poly);
      const frontM = inside ? 0 : hits[0].distanceM;
      const backM = hits[hits.length - 1].distanceM;
      return { front: roundYds(frontM), center, back: roundYds(backM), method: 'polygon' };
    }
  }
  if (isPoint(green.front) || isPoint(green.back)) {
    return {
      front: isPoint(green.front) ? roundYds(haversineMeters(golfer, green.front)) : null,
      center,
      back: isPoint(green.back) ? roundYds(haversineMeters(golfer, green.back)) : null,
      method: 'stored',
    };
  }
  return { front: null, center, back: null, method: 'centerOnly' };
}

// Split polygon edges into ~stepM pieces; returns local {x,y} points.
function densify(xy, stepM) {
  const out = [];
  const n = xy.length;
  const closed = n >= 3;
  const edges = closed ? n : n - 1;
  if (n === 1) return [xy[0]];
  for (let i = 0; i < edges; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(1, Math.ceil(len / stepM));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (!closed) out.push(xy[n - 1]);
  return out;
}

const SIDE_CENTER_YDS = 3;

// Where a hazard sits relative to the golfer -> target line.
// Frame: origin at golfer, +y toward target, +x to the right.
export function hazardDistances(golfer, target, hazard, { corridorYds = 25 } = {}) {
  const id = hazard?.id ?? null;
  const kind = hazard?.kind ?? null;
  const base = {
    id,
    kind,
    inPlay: false,
    reachYds: null,
    carryYds: null,
    side: 'center',
    lateralYds: null,
    distanceYds: null,
  };
  const poly = cleanPolygon(hazard?.polygon);
  if (!isPoint(golfer) || poly.length === 0) return base;

  const local = toLocal(golfer);
  const t = isPoint(target) ? local.project(target) : null;
  const targetDist = t ? Math.hypot(t.x, t.y) : 0;
  // Without a usable target, use north as +y so side is still defined.
  const ux = targetDist > 1 ? t.x / targetDist : 0;
  const uy = targetDist > 1 ? t.y / targetDist : 1;
  const frame = (p) => ({ x: p.x * uy - p.y * ux, y: p.x * ux + p.y * uy });

  const pts = densify(poly.map(local.project), 2).map(frame);
  const golferInside = pointInPolygon(golfer, poly);
  const corridorM = corridorYds * M_PER_YD;

  if (targetDist > 1) {
    const maxY = targetDist + 30 * M_PER_YD;
    const inC = pts.filter((p) => p.y > 0 && p.y < maxY && Math.abs(p.x) <= corridorM);
    if (inC.length > 0) {
      let minY = Infinity;
      let maxYIn = -Infinity;
      let sumX = 0;
      let minAbsX = Infinity;
      let hasL = false;
      let hasR = false;
      for (const p of inC) {
        minY = Math.min(minY, p.y);
        maxYIn = Math.max(maxYIn, p.y);
        sumX += p.x;
        minAbsX = Math.min(minAbsX, Math.abs(p.x));
        if (p.x < 0) hasL = true;
        if (p.x > 0) hasR = true;
      }
      const meanXYds = sumX / inC.length / M_PER_YD;
      const side =
        Math.abs(meanXYds) <= SIDE_CENTER_YDS ? 'center' : meanXYds > 0 ? 'right' : 'left';
      const reachM = golferInside ? 0 : minY;
      return {
        ...base,
        inPlay: true,
        reachYds: roundYds(reachM),
        carryYds: roundYds(maxYIn),
        side,
        lateralYds: hasL && hasR ? 0 : roundYds(minAbsX),
        distanceYds: roundYds(reachM),
      };
    }
  }

  let nearest = null;
  let nd = Infinity;
  for (const p of pts) {
    const d = Math.hypot(p.x, p.y);
    if (d < nd) {
      nd = d;
      nearest = p;
    }
  }
  const lateralYds = roundYds(Math.abs(nearest.x));
  return {
    ...base,
    side: lateralYds <= SIDE_CENTER_YDS ? 'center' : nearest.x > 0 ? 'right' : 'left',
    lateralYds,
    distanceYds: golferInside ? 0 : roundYds(nd),
  };
}

export const MAX_HAZARDS = 8;

export function hazardsForShot(golfer, target, hazards, opts) {
  if (!isPoint(golfer) || !Array.isArray(hazards)) return [];
  return hazards
    .filter((h) => h && cleanPolygon(h.polygon).length > 0)
    .map((h) => hazardDistances(golfer, target, h, opts))
    .sort((a, b) => {
      if (a.inPlay !== b.inPlay) return a.inPlay ? -1 : 1;
      const ka = a.inPlay ? a.reachYds : a.distanceYds;
      const kb = b.inPlay ? b.reachYds : b.distanceYds;
      return (ka ?? Infinity) - (kb ?? Infinity);
    })
    .slice(0, MAX_HAZARDS);
}

// Single entry point for the yardage UI and the shot-recommendation payload.
// holeModel is a CourseHole (docs/gps-contracts.md) after pin merging.
export function distanceSummary(golfer, holeModel) {
  const green = greenDistances(golfer, holeModel?.green);
  let target = isPoint(holeModel?.green?.center) ? holeModel.green.center : null;
  if (!target && Array.isArray(holeModel?.line)) {
    const linePts = holeModel.line.filter(isPoint);
    target = linePts.length ? linePts[linePts.length - 1] : null;
  }
  return { green, hazards: hazardsForShot(golfer, target, holeModel?.hazards) };
}

// course: { center_lat, center_lng, bbox_south, bbox_west, bbox_north, bbox_east }
export function isNearCourse(golfer, course, radiusM = 2000) {
  if (!isPoint(golfer) || !course) return false;
  const { bbox_south: s, bbox_west: w, bbox_north: n, bbox_east: e } = course;
  if ([s, w, n, e].every(Number.isFinite)) {
    if (golfer[0] >= s && golfer[0] <= n && golfer[1] >= w && golfer[1] <= e) return true;
  }
  const c = [course.center_lat, course.center_lng];
  return isPoint(c) && haversineMeters(golfer, c) <= radiusM;
}

// 'good' (<= 8 m and fresher than 10 s), 'fair' (<= 20 m and fresher than 30 s), else 'poor'.
export function gpsQuality(accuracyMeters, ageMs) {
  if (!Number.isFinite(accuracyMeters)) return 'poor';
  const age = Number.isFinite(ageMs) ? ageMs : Infinity;
  if (accuracyMeters <= 8 && age < 10000) return 'good';
  if (accuracyMeters <= 20 && age < 30000) return 'fair';
  return 'poor';
}
