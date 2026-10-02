import AsyncStorage from '@react-native-async-storage/async-storage';

// Local persistence for the round in progress, so a killed app or a dead zone on the
// course loses nothing. Every call swallows storage errors: losing the cache must never
// break scoring.

export const ACTIVE_ROUND_KEY = 'round:active';
const courseKey = (courseId) => `course:${courseId}`;

/**
 * Active round shape:
 * { roundId, courseId, courseName, loopKeys, currentHole, startingHole, holes, pendingSaves[] }
 * `holes` are formatted scorecard rows (api formatRound().holes); `pendingSaves` are
 * addHole payloads that failed to reach the server.
 */
export async function loadActiveRound() {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_ROUND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.roundId == null) return null;
    return {
      roundId: parsed.roundId,
      courseId: parsed.courseId ?? null,
      courseName: parsed.courseName ?? '',
      loopKeys: parsed.loopKeys ?? null,
      currentHole: parsed.currentHole ?? 1,
      startingHole: parsed.startingHole ?? 1,
      holes: Array.isArray(parsed.holes) ? parsed.holes : [],
      pendingSaves: Array.isArray(parsed.pendingSaves) ? parsed.pendingSaves : [],
    };
  } catch {
    return null;
  }
}

export async function saveActiveRound(round) {
  try {
    if (!round || round.roundId == null) {
      await AsyncStorage.removeItem(ACTIVE_ROUND_KEY);
      return;
    }
    await AsyncStorage.setItem(ACTIVE_ROUND_KEY, JSON.stringify(round));
  } catch {}
}

export async function clearActiveRound() {
  try {
    await AsyncStorage.removeItem(ACTIVE_ROUND_KEY);
  } catch {}
}

/** Course detail + the user's pins, cached for offline play: { detail, pins, savedAt }. */
export async function loadCourseCache(courseId) {
  if (courseId == null) return null;
  try {
    const raw = await AsyncStorage.getItem(courseKey(courseId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveCourseCache(courseId, { detail, pins }) {
  if (courseId == null) return;
  try {
    await AsyncStorage.setItem(
      courseKey(courseId),
      JSON.stringify({ detail: detail ?? null, pins: pins ?? [], savedAt: Date.now() }),
    );
  } catch {}
}

/**
 * Retry queued saves in order with saveFn(payload, roundId) (an idempotent upsert). Stops
 * at the first failure so order is kept. Each queued payload carries a unique `queueId`.
 * Returns { flushedIds, remaining, lastResult } where lastResult is the value of the last
 * successful saveFn call (e.g. the formatted round).
 */
export async function flushPendingSaves(saveFn) {
  const round = await loadActiveRound();
  if (!round || round.pendingSaves.length === 0) {
    return { flushedIds: [], remaining: [], lastResult: null };
  }

  let lastResult = null;
  const flushedIds = [];
  for (const payload of round.pendingSaves) {
    try {
      lastResult = await saveFn(payload, round.roundId);
      flushedIds.push(payload.queueId);
    } catch {
      break;
    }
  }

  // Re-read so a hole queued meanwhile isn't dropped.
  const latest = (await loadActiveRound()) || round;
  const remaining = latest.pendingSaves.filter((p) => !flushedIds.includes(p.queueId));
  if (latest.roundId === round.roundId) await saveActiveRound({ ...latest, pendingSaves: remaining });
  return { flushedIds, remaining, lastResult };
}
