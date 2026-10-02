// Suggests which hole the golfer is on. Never switches holes itself: the UI
// shows the suggestion and the golfer confirms.
import { haversineMeters, distancePointToPolyline } from './distance';

export const NEXT_TEE_RADIUS_M = 25;
export const LEAVE_GREEN_M = 60;
export const HOLE_LINE_RADIUS_M = 30;
export const LOW_CONFIDENCE_FIXES = 3;

// Mutable state the caller keeps (e.g. in a ref) and passes back on every fix.
export function createHoleDetectionState() {
  return { candidate: null, count: 0 };
}

function isPoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function holeNumberOf(h) {
  if (h == null) return null;
  return typeof h === 'number' ? h : h.hole_number ?? null;
}

// Hole centre line: `line` if present, otherwise tee -> green centre.
function holeLine(hole) {
  const line = Array.isArray(hole.line) ? hole.line.filter(isPoint) : [];
  if (line.length >= 2) return line;
  const pts = [hole.tee, hole.green?.center].filter(isPoint);
  return pts.length ? pts : null;
}

// First hole after `current` (wrapping) that hasn't been scored; falls back to
// the plain next hole if all are scored.
function nextHole(holes, current, scored) {
  const sorted = holes
    .filter((h) => Number.isFinite(h?.hole_number))
    .sort((a, b) => a.hole_number - b.hole_number);
  if (!sorted.length) return null;
  let idx = sorted.findIndex((h) => h.hole_number > current);
  if (idx < 0) idx = 0;
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[(idx + i) % sorted.length];
    if (h.hole_number !== current && !scored.has(h.hole_number)) return h;
  }
  const plain = sorted[idx];
  return plain.hole_number !== current ? plain : null;
}

function resetState(state) {
  if (state) {
    state.candidate = null;
    state.count = 0;
  }
}

/**
 * @param golfer [lat,lng] | null
 * @param holes CourseHole[] (merged with user pins)
 * @param currentHole number | CourseHole | null
 * @param scoredHoleNumbers number[] | Set<number>
 * @param state object from createHoleDetectionState(); mutated in place
 * @returns {{ holeNumber, confidence: 'high'|'low', reason: 'next_tee'|'at_tee'|'on_hole_line' } | null}
 */
export function suggestHole(golfer, holes, currentHole, scoredHoleNumbers, state) {
  if (!isPoint(golfer) || !Array.isArray(holes) || holes.length === 0) return null;
  const scored = new Set(scoredHoleNumbers || []);
  const currentNum = holeNumberOf(currentHole);
  const current =
    currentNum == null ? null : holes.find((h) => h?.hole_number === currentNum) || null;

  // Rule 1: standing on the next tee and clear of the current green.
  if (currentNum == null) {
    let best = null;
    let bestD = Infinity;
    for (const h of holes) {
      if (!isPoint(h?.tee) || scored.has(h.hole_number)) continue;
      const d = haversineMeters(golfer, h.tee);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best && bestD <= NEXT_TEE_RADIUS_M) {
      resetState(state);
      return { holeNumber: best.hole_number, confidence: 'high', reason: 'at_tee' };
    }
  } else {
    const next = nextHole(holes, currentNum, scored);
    if (next && isPoint(next.tee)) {
      const greenC = current?.green?.center;
      const fromGreen = isPoint(greenC) ? haversineMeters(golfer, greenC) : Infinity;
      if (haversineMeters(golfer, next.tee) <= NEXT_TEE_RADIUS_M && fromGreen > LEAVE_GREEN_M) {
        resetState(state);
        return { holeNumber: next.hole_number, confidence: 'high', reason: 'next_tee' };
      }
    }
  }

  // Rule 2: consistently closest to another (unscored) hole's line.
  let nearest = null;
  let nearestD = Infinity;
  for (const h of holes) {
    if (!Number.isFinite(h?.hole_number)) continue;
    if (h.hole_number !== currentNum && scored.has(h.hole_number)) continue;
    const line = holeLine(h);
    if (!line) continue;
    const d = distancePointToPolyline(golfer, line);
    if (d != null && d < nearestD) {
      nearestD = d;
      nearest = h;
    }
  }
  if (!nearest || nearestD > HOLE_LINE_RADIUS_M || nearest.hole_number === currentNum) {
    resetState(state);
    return null;
  }
  if (!state) return null; // low-confidence needs consecutive fixes
  if (state.candidate === nearest.hole_number) {
    state.count += 1;
  } else {
    state.candidate = nearest.hole_number;
    state.count = 1;
  }
  if (state.count >= LOW_CONFIDENCE_FIXES) {
    return { holeNumber: nearest.hole_number, confidence: 'low', reason: 'on_hole_line' };
  }
  return null;
}
