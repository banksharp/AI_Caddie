// Course search (signed-in, free). DB cache first, then OpenStreetMap (Overpass / Nominatim).
// Privacy: the request's lat/lng is used for the query only and is never logged.

import { corsHeaders } from '../_shared/cors.ts';
import { jsonResponse, requireUser } from '../_shared/auth.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { type CourseSummary, getCourseProvider } from '../_shared/courseProvider.ts';
import { haversineMeters } from '../_shared/geo.ts';

const DEFAULT_RADIUS_M = 25_000;
const MAX_RADIUS_M = 50_000;
const CELL_TTL_MS = 30 * 24 * 3600 * 1000;
/** Extra Overpass radius so a cached cell covers searches from anywhere inside it (~half a 0.1° cell diagonal). */
const CELL_SLACK_M = 8_000;
const MAX_RESULTS = 50;
const MIN_DB_NAME_HITS = 3;

const COURSE_COLUMNS = 'id, name, city, region, center_lat, center_lng, hole_data_status, hole_count, source';

interface CourseRow {
  id: number;
  name: string;
  city: string | null;
  region: string | null;
  center_lat: number;
  center_lng: number;
  hole_data_status: string;
  hole_count: number | null;
  source: string;
}

// Best-effort per-user rate limit (per isolate; resets on cold start).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return false;
}

function cellKey(lat: number, lng: number) {
  return `${(Math.floor(lat * 10) / 10).toFixed(1)}:${(Math.floor(lng * 10) / 10).toFixed(1)}`;
}

function toResult(row: CourseRow, from: { lat: number; lng: number } | null) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    region: row.region,
    center_lat: row.center_lat,
    center_lng: row.center_lng,
    distance_m: from ? Math.round(haversineMeters([from.lat, from.lng], [row.center_lat, row.center_lng])) : null,
    hole_data_status: row.hole_data_status,
    hole_count: row.hole_count,
    source: row.source,
  };
}

// deno-lint-ignore no-explicit-any
type Client = any;

async function dbNearby(db: Client, lat: number, lng: number, radiusM: number): Promise<CourseRow[]> {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const { data, error } = await db
    .from('courses')
    .select(COURSE_COLUMNS)
    .gte('center_lat', lat - dLat)
    .lte('center_lat', lat + dLat)
    .gte('center_lng', lng - dLng)
    .lte('center_lng', lng + dLng)
    .limit(1000);
  if (error) throw new Error(`courses query failed: ${error.message}`);
  return (data as CourseRow[])
    .map((r) => ({ r, d: haversineMeters([lat, lng], [r.center_lat, r.center_lng]) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_RESULTS)
    .map((x) => x.r);
}

async function dbByName(db: Client, query: string, near: { lat: number; lng: number } | null): Promise<CourseRow[]> {
  const { data, error } = await db.rpc('search_courses_by_name', {
    q: query,
    p_lat: near?.lat ?? null,
    p_lng: near?.lng ?? null,
    lim: 20,
  });
  if (error) throw new Error(`name search failed: ${error.message}`);
  return data as CourseRow[];
}

/** Upserts provider results into the shared cache and returns their rows. */
async function upsertCourses(admin: Client, courses: CourseSummary[]): Promise<CourseRow[]> {
  if (!courses.length) return [];
  // Dedupe within the batch (ON CONFLICT can't touch the same row twice).
  const unique = [...new Map(courses.map((c) => [`${c.osm_type}/${c.osm_id}`, c])).values()];
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('courses')
    .upsert(unique.map((c) => ({ ...c, updated_at: now })), { onConflict: 'osm_type,osm_id' })
    .select(COURSE_COLUMNS);
  if (error) throw new Error(`courses upsert failed: ${error.message}`);
  return data as CourseRow[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if ('error' in auth) return auth.error;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ detail: 'Invalid JSON body' }, 400);
    }
    if (!body || typeof body !== 'object') return jsonResponse({ detail: 'Invalid JSON body' }, 400);

    const hasLat = body.lat !== undefined && body.lat !== null;
    const hasLng = body.lng !== undefined && body.lng !== null;
    let near: { lat: number; lng: number } | null = null;
    if (hasLat || hasLng) {
      const lat = body.lat, lng = body.lng;
      if (
        typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        return jsonResponse({ detail: 'lat and lng must be valid coordinates' }, 400);
      }
      near = { lat, lng };
    }

    let query: string | null = null;
    if (body.query !== undefined && body.query !== null) {
      if (typeof body.query !== 'string') return jsonResponse({ detail: 'query must be a string' }, 400);
      // deno-lint-ignore no-control-regex
      const q = body.query.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (q.length < 2 || q.length > 80) return jsonResponse({ detail: 'query must be 2-80 characters' }, 400);
      query = q;
    }
    if (!near && !query) return jsonResponse({ detail: 'Provide lat and lng, or query' }, 400);

    let radiusM = DEFAULT_RADIUS_M;
    if (body.radius_m !== undefined && body.radius_m !== null) {
      if (typeof body.radius_m !== 'number' || !Number.isFinite(body.radius_m) || body.radius_m <= 0) {
        return jsonResponse({ detail: 'radius_m must be a positive number' }, 400);
      }
      radiusM = Math.min(Math.round(body.radius_m), MAX_RADIUS_M);
    }

    if (rateLimited(auth.user.id)) {
      return jsonResponse({ detail: 'Too many searches. Please wait a minute and try again.' }, 429);
    }

    const db = auth.supabase;
    const admin = getSupabaseAdmin();
    const provider = getCourseProvider();

    // Name search ----------------------------------------------------------------------
    if (query) {
      const cached = await dbByName(db, query, near);
      if (cached.length >= MIN_DB_NAME_HITS) {
        return jsonResponse({ courses: cached.map((r) => toResult(r, near)), degraded: false });
      }
      try {
        const found = await provider.searchByName(query, near ?? undefined);
        const upserted = await upsertCourses(admin, found);
        // Provider hits first (they matched the query at the source, e.g. Nominatim also
        // matches on place names), then any other cached fuzzy matches.
        const merged = [...upserted];
        const ids = new Set(merged.map((r) => r.id));
        for (const r of cached) {
          if (!ids.has(r.id)) {
            ids.add(r.id);
            merged.push(r);
          }
        }
        if (near) {
          merged.sort((a, b) =>
            haversineMeters([near!.lat, near!.lng], [a.center_lat, a.center_lng]) -
            haversineMeters([near!.lat, near!.lng], [b.center_lat, b.center_lng])
          );
        }
        return jsonResponse({ courses: merged.slice(0, MAX_RESULTS).map((r) => toResult(r, near)), degraded: false });
      } catch (err) {
        console.error('course-search name provider error:', (err as Error).message);
        return jsonResponse({
          detail: 'Course search is temporarily unavailable',
          code: 'provider_unavailable',
          courses: cached.map((r) => toResult(r, near)),
          degraded: true,
        }, 503);
      }
    }

    // Nearby search --------------------------------------------------------------------
    const { lat, lng } = near!;
    const key = cellKey(lat, lng);
    const { data: cell } = await admin
      .from('course_search_cells')
      .select('searched_at, radius_m')
      .eq('cell_key', key)
      .maybeSingle();
    const fresh = cell && Date.now() - new Date(cell.searched_at).getTime() < CELL_TTL_MS && cell.radius_m >= radiusM;
    if (fresh) {
      const rows = await dbNearby(db, lat, lng, radiusM);
      return jsonResponse({ courses: rows.map((r) => toResult(r, near)), degraded: false });
    }

    try {
      const found = await provider.searchNearby(lat, lng, Math.min(radiusM + CELL_SLACK_M, MAX_RADIUS_M + CELL_SLACK_M));
      const upserted = await upsertCourses(admin, found);
      const { error: cellError } = await admin.from('course_search_cells').upsert({
        cell_key: key,
        course_ids: upserted.map((r) => r.id),
        radius_m: radiusM,
        searched_at: new Date().toISOString(),
      });
      if (cellError) console.error('course_search_cells upsert failed:', cellError.message);
      const rows = await dbNearby(db, lat, lng, radiusM);
      return jsonResponse({ courses: rows.map((r) => toResult(r, near)), degraded: false });
    } catch (err) {
      console.error('course-search nearby provider error:', (err as Error).message);
      const rows = await dbNearby(db, lat, lng, radiusM).catch(() => [] as CourseRow[]);
      return jsonResponse({
        detail: 'Course search is temporarily unavailable',
        code: 'provider_unavailable',
        courses: rows.map((r) => toResult(r, near)),
        degraded: true,
      }, 503);
    }
  } catch (err) {
    console.error('course-search error:', (err as Error).message);
    return jsonResponse({ detail: 'Course search failed' }, 500);
  }
});
