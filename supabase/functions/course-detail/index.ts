// Course detail (signed-in, free): returns a course's holes, fetching and caching them from
// OpenStreetMap on first use. One fetcher at a time per course (claim_course_fetch); other
// callers wait briefly and otherwise get status 'fetching' (the app retries).

import { corsHeaders } from '../_shared/cors.ts';
import { jsonResponse, requireUser } from '../_shared/auth.ts';
import { getSupabaseAdmin } from '../_shared/supabase.ts';
import { getCourseProvider, OSM_ATTRIBUTION } from '../_shared/courseProvider.ts';
import { type CourseHoleRow, rowToCourseHole } from '../_shared/osmGolf.ts';

const TTL_DAYS: Record<string, number> = { ready: 180, partial: 180, none: 30 };
const REFRESH_MIN_AGE_MS = 7 * 24 * 3600 * 1000;
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 20_000;

const COURSE_COLUMNS = 'id, name, city, region, center_lat, center_lng, bbox_south, bbox_west, bbox_north, ' +
  'bbox_east, hole_data_status, hole_count, unassigned_greens, geometry_fetched_at, osm_type, osm_id, source';

interface CourseRow {
  id: number;
  name: string;
  city: string | null;
  region: string | null;
  center_lat: number;
  center_lng: number;
  bbox_south: number | null;
  bbox_west: number | null;
  bbox_north: number | null;
  bbox_east: number | null;
  hole_data_status: string;
  hole_count: number | null;
  unassigned_greens: unknown[] | null;
  geometry_fetched_at: string | null;
  osm_type: string | null;
  osm_id: number | null;
  source: string;
}

// deno-lint-ignore no-explicit-any
type Client = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isFresh(course: CourseRow): boolean {
  const days = TTL_DAYS[course.hole_data_status];
  if (days === undefined || !course.geometry_fetched_at) return false;
  return Date.now() - new Date(course.geometry_fetched_at).getTime() < days * 24 * 3600 * 1000;
}

async function loadCourse(db: Client, id: number): Promise<CourseRow | null> {
  const { data, error } = await db.from('courses').select(COURSE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`course query failed: ${error.message}`);
  return data as CourseRow | null;
}

async function loadHoles(db: Client, id: number) {
  const { data, error } = await db
    .from('course_holes')
    .select('*')
    .eq('course_id', id)
    .order('loop_key')
    .order('hole_number');
  if (error) throw new Error(`holes query failed: ${error.message}`);
  return ((data ?? []) as CourseHoleRow[]).map(rowToCourseHole);
}

async function respond(db: Client, course: CourseRow, status: string, httpStatus = 200, extra: Record<string, unknown> = {}) {
  const holes = await loadHoles(db, course.id);
  return jsonResponse({
    course: {
      id: course.id,
      name: course.name,
      city: course.city,
      region: course.region,
      center_lat: course.center_lat,
      center_lng: course.center_lng,
      bbox_south: course.bbox_south,
      bbox_west: course.bbox_west,
      bbox_north: course.bbox_north,
      bbox_east: course.bbox_east,
      hole_data_status: course.hole_data_status,
      hole_count: course.hole_count,
    },
    status,
    holes,
    unassigned_greens: Array.isArray(course.unassigned_greens) ? course.unassigned_greens : [],
    attribution: OSM_ATTRIBUTION,
    ...extra,
  }, httpStatus);
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
    const courseId = body?.course_id;
    if (typeof courseId !== 'number' || !Number.isInteger(courseId) || courseId <= 0) {
      return jsonResponse({ detail: 'course_id must be a positive integer' }, 400);
    }
    if (body.refresh !== undefined && typeof body.refresh !== 'boolean') {
      return jsonResponse({ detail: 'refresh must be a boolean' }, 400);
    }
    const refresh = body.refresh === true;

    const db = auth.supabase;
    const admin = getSupabaseAdmin();

    let course = await loadCourse(db, courseId);
    if (!course) return jsonResponse({ detail: 'Course not found' }, 404);

    // Only OSM courses can be fetched; others are served as stored.
    if (course.source !== 'osm' || !course.osm_type || !course.osm_id) {
      const status = ['ready', 'partial', 'none'].includes(course.hole_data_status) ? course.hole_data_status : 'none';
      return await respond(db, course, status);
    }

    // `refresh` is honored only when the cached geometry is at least 7 days old.
    const force = refresh && !!course.geometry_fetched_at &&
      Date.now() - new Date(course.geometry_fetched_at).getTime() > REFRESH_MIN_AGE_MS;

    if (isFresh(course) && !force) return await respond(db, course, course.hole_data_status);

    const previous = { status: course.hole_data_status, fetchedAt: course.geometry_fetched_at };
    const ttlDays = TTL_DAYS[course.hole_data_status] ?? 180;
    const { data: claimed, error: claimError } = await admin.rpc('claim_course_fetch', {
      p_course_id: courseId,
      p_ttl: `${ttlDays} days`,
      p_force: force,
    });
    if (claimError) throw new Error(`claim_course_fetch failed: ${claimError.message}`);

    if (!claimed) {
      // A failed fetch is in its retry cooldown: report the error now rather than waiting.
      if (course.hole_data_status === 'error') {
        return await respond(db, course, 'error', 503, { detail: 'Course data is temporarily unavailable' });
      }
      // Someone else is fetching: wait for them, briefly.
      const deadline = Date.now() + POLL_MAX_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        course = (await loadCourse(db, courseId))!;
        if (course.hole_data_status !== 'fetching') break;
      }
      if (['ready', 'partial', 'none'].includes(course.hole_data_status)) {
        return await respond(db, course, course.hole_data_status);
      }
      if (course.hole_data_status === 'error') {
        return await respond(db, course, 'error', 503, { detail: 'Course data is temporarily unavailable' });
      }
      return await respond(db, course, 'fetching');
    }

    // We hold the claim: fetch, parse, store.
    try {
      const geometry = await getCourseProvider().fetchCourseGeometry(course);
      const { error } = await admin.rpc('replace_course_holes', {
        p_course_id: courseId,
        p_holes: geometry.holes,
        p_status: geometry.status,
        p_unassigned_greens: geometry.unassignedGreens,
        p_boundary: geometry.boundary,
        p_error: null,
      });
      if (error) throw new Error(`replace_course_holes failed: ${error.message}`);
      course = (await loadCourse(db, courseId))!;
      return await respond(db, course, course.hole_data_status);
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      console.error(`course-detail fetch failed for course ${courseId}:`, message);
      // A failed refresh keeps the previously cached holes; a first fetch becomes 'error'.
      const hadData = ['ready', 'partial', 'none'].includes(previous.status) && previous.fetchedAt;
      await admin
        .from('courses')
        .update({
          hole_data_status: hadData ? previous.status : 'error',
          fetch_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', courseId);
      course = (await loadCourse(db, courseId))!;
      if (hadData) return await respond(db, course, course.hole_data_status);
      return await respond(db, course, 'error', 503, { detail: 'Course data is temporarily unavailable' });
    }
  } catch (err) {
    console.error('course-detail error:', (err as Error).message);
    return jsonResponse({ detail: 'Course detail failed' }, 500);
  }
});
