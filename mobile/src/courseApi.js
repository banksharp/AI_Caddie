import { supabase } from './supabase';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Course search / detail (edge functions, free) ──

/**
 * Courses near a point and/or matching a name. Returns { courses, degraded }.
 * A 503 from the provider still carries cached courses, so those are returned (degraded).
 */
export async function searchCourses({ lat, lng, query } = {}) {
  const body = {};
  if (lat != null && lng != null) {
    // Round to 2 decimals (about 1 km) so only an approximate location leaves the phone,
    // as the privacy policy says; that is plenty for a 25 km course search.
    body.lat = Math.round(lat * 100) / 100;
    body.lng = Math.round(lng * 100) / 100;
  }
  if (query && query.trim()) body.query = query.trim();

  const { data, error } = await supabase.functions.invoke('course-search', { body });
  if (error) {
    let payload = null;
    try {
      payload = await error.context?.json();
    } catch {}
    if (payload?.degraded && Array.isArray(payload.courses)) {
      return { courses: payload.courses, degraded: true, detail: payload.detail };
    }
    if (error.context?.status === 429) {
      throw new Error('Too many searches. Wait a moment and try again.');
    }
    throw new Error(payload?.detail || error.message);
  }
  return { courses: data?.courses || [], degraded: !!data?.degraded };
}

function normalizeDetail(data, fallbackStatus) {
  return {
    course: data?.course ?? null,
    status: data?.status ?? fallbackStatus,
    holes: Array.isArray(data?.holes) ? data.holes : [],
    unassigned_greens: Array.isArray(data?.unassigned_greens) ? data.unassigned_greens : [],
    attribution: data?.attribution,
  };
}

/**
 * Course geometry. A first (cold) fetch can take up to about a minute server-side, so no
 * client timeout is set. While the server is still fetching the status is 'fetching'
 * (possibly with holes from an earlier fetch, passed to onProgress); retry after 2s, 4s
 * and 8s. A 503 resolves to its body with status 'error' (holes possibly []) so the caller
 * can fall back to tap-to-set pins.
 */
export async function getCourseDetail(courseId, { refresh = false, onProgress } = {}) {
  const delays = [2000, 4000, 8000];
  let attempt = 0;
  let wantRefresh = refresh;
  for (;;) {
    const { data, error } = await supabase.functions.invoke('course-detail', {
      body: wantRefresh ? { course_id: courseId, refresh: true } : { course_id: courseId },
    });
    // Only ask for a refresh once; retries just poll.
    wantRefresh = false;

    if (error) {
      let body = null;
      try {
        body = await error.context?.json();
      } catch {}
      if (error.context?.status === 503) {
        return { ...normalizeDetail(body, 'error'), status: 'error', error: body?.detail || error.message };
      }
      throw new Error(body?.detail || error.message);
    }

    const detail = normalizeDetail(data, 'none');
    if (detail.status === 'fetching' && attempt < delays.length) {
      if (detail.holes.length > 0) onProgress?.(detail);
      await sleep(delays[attempt]);
      attempt += 1;
      continue;
    }
    return detail;
  }
}

// ── User pins (direct table access, owner-only RLS) ──

export async function getUserPins(courseId) {
  const { data, error } = await supabase
    .from('user_hole_pins')
    .select('*')
    .eq('course_id', courseId);
  if (error) throw new Error(error.message);
  return data || [];
}

const lat = (p) => (Array.isArray(p) ? p[0] : null);
const lng = (p) => (Array.isArray(p) ? p[1] : null);

export async function saveUserPin(courseId, { loopKey = '', holeNumber, par, center, front, back, tee }) {
  if (!Array.isArray(center)) throw new Error('Green center is required');
  const row = {
    course_id: courseId,
    loop_key: loopKey || '',
    hole_number: holeNumber,
    par: par ?? null,
    green_center_lat: lat(center),
    green_center_lng: lng(center),
    green_front_lat: lat(front),
    green_front_lng: lng(front),
    green_back_lat: lat(back),
    green_back_lng: lng(back),
    tee_lat: lat(tee),
    tee_lng: lng(tee),
  };
  // user_id defaults to auth.uid() on the server.
  const { data, error } = await supabase
    .from('user_hole_pins')
    .upsert(row, { onConflict: 'user_id,course_id,loop_key,hole_number' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Hole models ──

const point = (la, ln) => (la != null && ln != null ? [Number(la), Number(ln)] : null);

function straightYards(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return Math.round((2 * R * Math.asin(Math.sqrt(h))) / 0.9144);
}

function emptyHole(loopKey, holeNumber) {
  return {
    hole_number: holeNumber,
    loop_key: loopKey,
    par: null,
    handicap: null,
    length_yds: null,
    tee: null,
    line: null,
    green: { center: null, front: null, back: null, polygon: null },
    hazards: [],
    source: 'none',
  };
}

export const holeKey = (loopKey, holeNumber) => `${loopKey || ''}|${holeNumber}`;

/**
 * Merge course-detail holes with the user's pins (contract: a pin overrides green
 * center/front/back, tee and par and sets source 'user'; pin-only holes are added).
 * Missing holes become placeholders (source 'none') so the user can set greens.
 */
export function buildHoleModels(detail, pins) {
  const byKey = new Map();
  for (const h of detail?.holes || []) {
    const loopKey = h.loop_key || '';
    byKey.set(holeKey(loopKey, h.hole_number), {
      ...emptyHole(loopKey, h.hole_number),
      ...h,
      loop_key: loopKey,
      green: { center: null, front: null, back: null, polygon: null, ...(h.green || {}) },
      hazards: Array.isArray(h.hazards) ? h.hazards : [],
      source: h.source || 'osm',
    });
  }

  for (const p of pins || []) {
    const loopKey = p.loop_key || '';
    const key = holeKey(loopKey, p.hole_number);
    const base = byKey.get(key) || emptyHole(loopKey, p.hole_number);
    const center = point(p.green_center_lat, p.green_center_lng);
    if (!center) continue;
    const tee = point(p.tee_lat, p.tee_lng) || base.tee;
    const merged = {
      ...base,
      par: p.par ?? base.par,
      tee,
      green: {
        ...base.green,
        center,
        front: point(p.green_front_lat, p.green_front_lng),
        back: point(p.green_back_lat, p.green_back_lng),
      },
      source: 'user',
    };
    if (merged.length_yds == null && tee) merged.length_yds = straightYards(tee, center);
    byKey.set(key, merged);
  }

  // Fill missing holes with placeholders so every hole can get a pin: a single-loop course
  // up to its hole count (18 if unknown, also when there is no data at all); each loop of a
  // multi-loop course up to its highest hole number.
  const loops = new Map();
  for (const h of byKey.values()) {
    loops.set(h.loop_key, Math.max(loops.get(h.loop_key) || 0, h.hole_number));
  }
  if (loops.size <= 1) {
    const loopKey = loops.size === 1 ? [...loops.keys()][0] : '';
    const count = Math.max(Number(detail?.course?.hole_count) || 18, loops.get(loopKey) || 0);
    loops.set(loopKey, count);
  }
  for (const [loopKey, max] of loops) {
    for (let n = 1; n <= max; n += 1) {
      const key = holeKey(loopKey, n);
      if (!byKey.has(key)) byKey.set(key, emptyHole(loopKey, n));
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.loop_key !== b.loop_key) return a.loop_key < b.loop_key ? -1 : 1;
    return a.hole_number - b.hole_number;
  });
}

/** Distinct loop keys in a model list, in sorted order. */
export function loopKeysOf(models) {
  return [...new Set((models || []).map((h) => h.loop_key || ''))];
}

/**
 * The holes played in this round. `hole_number` becomes the number saved on the scorecard
 * and `course_hole_number` keeps the course's own number (used for pins). With several
 * loops chosen (e.g. two nines of a 27-hole course) the loops are
 * played in order and renumbered 1..n when their own numbers would collide.
 */
export function holesForRound(models, loopKeys) {
  const all = models || [];
  const keys = Array.isArray(loopKeys) && loopKeys.length > 0 ? loopKeys : null;
  // No loop chosen: play every loop in sorted order (models are already sorted that way).
  let list = keys ? keys.flatMap((k) => all.filter((h) => (h.loop_key || '') === k)) : all;
  if (list.length === 0) list = all;
  const numbers = list.map((h) => h.hole_number);
  const unique = new Set(numbers).size === numbers.length;
  return list.map((h, i) => ({
    ...h,
    hole_number: unique ? h.hole_number : i + 1,
    course_hole_number: h.hole_number,
  }));
}
