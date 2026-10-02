import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import * as api from '../api';
import * as store from './roundStore';

// A locally stored round older than this with nothing left to sync is dropped on launch.
const STALE_LOCAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 30 * 1000;

const idle = {
  status: 'loading', // 'loading' | 'idle' | 'active'
  roundId: null,
  courseId: null,
  courseName: '',
  loopKeys: null,
  startedAt: null,
  currentHole: 1,
  startingHole: 1,
  holes: [], // last scorecard confirmed by the server
  pendingSaves: [], // addHole payloads waiting for the network
};

function holeRow(p) {
  const par = p.par != null ? parseInt(p.par, 10) : null;
  return {
    hole_number: p.hole_number,
    par,
    strokes: p.strokes,
    score_vs_par: par != null ? p.strokes - par : null,
    putts: p.putts ?? null,
    fairway_hit: p.fairway_hit ?? null,
    gir: p.gir ?? null,
    notes: p.notes ?? null,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'START':
    case 'RESUME': {
      const r = action.round;
      if (!r) return { ...idle, status: 'idle' };
      return {
        ...idle,
        status: 'active',
        roundId: r.roundId,
        courseId: r.courseId ?? null,
        courseName: r.courseName ?? '',
        loopKeys: r.loopKeys ?? null,
        startedAt: r.startedAt ?? null,
        currentHole: r.currentHole ?? r.startingHole ?? 1,
        startingHole: r.startingHole ?? 1,
        holes: r.holes ?? [],
        pendingSaves: r.pendingSaves ?? [],
      };
    }
    case 'SET_HOLE':
      return state.status === 'active' ? { ...state, currentHole: action.hole } : state;
    case 'HOLE_SAVED': {
      // Server scorecard; drop queued saves it has now absorbed.
      const flushed = action.flushedIds || [];
      return {
        ...state,
        holes: action.round?.holes ?? state.holes,
        pendingSaves: state.pendingSaves.filter(
          (p) => !flushed.includes(p.queueId) && p.hole_number !== action.holeNumber,
        ),
      };
    }
    case 'QUEUE_SAVE': {
      // Only the newest save per hole matters (the server upserts by hole number).
      const others = state.pendingSaves.filter((p) => p.hole_number !== action.payload.hole_number);
      return { ...state, pendingSaves: [...others, action.payload] };
    }
    case 'FINISH':
      return { ...idle, status: 'idle' };
    default:
      return state;
  }
}

function toStored(state) {
  return {
    roundId: state.roundId,
    courseId: state.courseId,
    courseName: state.courseName,
    loopKeys: state.loopKeys,
    startedAt: state.startedAt,
    currentHole: state.currentHole,
    startingHole: state.startingHole,
    holes: state.holes,
    pendingSaves: state.pendingSaves,
  };
}

function isNetworkError(err) {
  const msg = String(err?.message || err || '');
  return /network|fetch|timed? ?out|offline|load failed|connection|internet/i.test(msg);
}

/** First hole after the scored ones in play order, used when resuming from the server. */
function nextAfter(holes) {
  if (!holes || holes.length === 0) return 1;
  return Math.max(...holes.map((h) => h.hole_number)) + 1;
}

/**
 * The round in progress: start/resume/finish, current hole, and offline-safe hole saves.
 * State is written through to AsyncStorage on every change.
 */
export function useRoundSession() {
  const [state, dispatch] = useReducer(reducer, idle);
  const stateRef = useRef(state);
  stateRef.current = state;
  const flushingRef = useRef(false);

  // Write-through to local storage (skip the initial loading state).
  useEffect(() => {
    if (state.status === 'active') store.saveActiveRound(toStored(state));
  }, [state]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    const s = stateRef.current;
    if (s.status !== 'active' || s.pendingSaves.length === 0) return;
    flushingRef.current = true;
    try {
      // Make sure the store has the latest queue before flushing from it.
      await store.saveActiveRound(toStored(stateRef.current));
      const { flushedIds, lastResult } = await store.flushPendingSaves(
        (payload, roundId) => {
          const { queueId, ...holeData } = payload;
          return api.addHole(roundId, holeData);
        },
      );
      if (flushedIds.length > 0) {
        dispatch({ type: 'HOLE_SAVED', round: lastResult, flushedIds });
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  // Resume on mount: local store first, else the server's unfinished round.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let local = await store.loadActiveRound();
      if (
        local
        && local.pendingSaves.length === 0
        && local.startedAt
        && Date.now() - new Date(local.startedAt).getTime() > STALE_LOCAL_MS
      ) {
        await store.clearActiveRound();
        local = null;
      }
      if (local) {
        if (!cancelled) dispatch({ type: 'RESUME', round: local });
        return;
      }
      try {
        const remote = await api.getActiveRound();
        if (cancelled) return;
        dispatch({
          type: 'RESUME',
          round: remote
            ? {
              roundId: remote.round_id,
              courseId: remote.course_id,
              courseName: remote.course_name || '',
              loopKeys: remote.loop_keys,
              startedAt: remote.started_at,
              holes: remote.holes,
              startingHole: 1,
              currentHole: nextAfter(remote.holes),
            }
            : null,
        });
      } catch {
        if (!cancelled) dispatch({ type: 'RESUME', round: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Flush queued saves once resumed, when the app returns to the foreground, and
  // periodically while anything is waiting.
  const hasPending = state.pendingSaves.length > 0;
  useEffect(() => {
    if (state.status !== 'active') return undefined;
    flush();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') flush();
    });
    const timer = hasPending ? setInterval(flush, RETRY_INTERVAL_MS) : null;
    return () => {
      sub.remove();
      if (timer) clearInterval(timer);
    };
  }, [state.status, state.roundId, hasPending, flush]);

  const start = useCallback(async ({ courseName, courseId = null, loopKeys = null, startingHole = 1 }) => {
    const r = await api.startRound(courseName, courseId, loopKeys);
    const round = {
      roundId: r.round_id,
      courseId: r.course_id ?? courseId,
      courseName: r.course_name || courseName || '',
      loopKeys: r.loop_keys ?? loopKeys,
      startedAt: r.started_at,
      startingHole,
      currentHole: startingHole,
      holes: [],
      pendingSaves: [],
    };
    await store.saveActiveRound(round);
    dispatch({ type: 'START', round });
    return round;
  }, []);

  const setHole = useCallback((hole) => dispatch({ type: 'SET_HOLE', hole }), []);

  /**
   * Save a hole score. Resolves { queued: false } when the server has it, or
   * { queued: true } when it was kept locally to retry (no connection). Other errors throw.
   */
  const saveHole = useCallback(async (holeData) => {
    const s = stateRef.current;
    if (s.status !== 'active') throw new Error('No round in progress');
    try {
      const round = await api.addHole(s.roundId, holeData);
      dispatch({ type: 'HOLE_SAVED', round, holeNumber: holeData.hole_number });
      return { queued: false };
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const payload = { ...holeData, queueId: `${Date.now()}-${holeData.hole_number}` };
      dispatch({ type: 'QUEUE_SAVE', payload });
      return { queued: true };
    }
  }, []);

  /** Mark the round finished. With { force: true } it is cleared locally even if offline. */
  const finish = useCallback(async ({ force = false } = {}) => {
    const s = stateRef.current;
    if (s.status !== 'active') return;
    if (!force) {
      await flush();
      await api.finishRound(s.roundId);
    } else {
      api.finishRound(s.roundId).catch(() => {});
    }
    await store.clearActiveRound();
    dispatch({ type: 'FINISH' });
  }, [flush]);

  // Scorecard = server rows with queued saves laid over them.
  const holes = useMemo(() => {
    const byNumber = new Map(state.holes.map((h) => [h.hole_number, h]));
    for (const p of state.pendingSaves) byNumber.set(p.hole_number, { ...holeRow(p), pending: true });
    return [...byNumber.values()].sort((a, b) => a.hole_number - b.hole_number);
  }, [state.holes, state.pendingSaves]);

  const totals = useMemo(() => {
    if (holes.length === 0) return { totalScore: null, totalVsPar: null };
    const totalScore = holes.reduce((sum, h) => sum + (h.strokes || 0), 0);
    const withPar = holes.filter((h) => h.par != null);
    const totalPar = withPar.reduce((sum, h) => sum + h.par, 0);
    const parStrokes = withPar.reduce((sum, h) => sum + (h.strokes || 0), 0);
    return { totalScore, totalVsPar: totalPar > 0 ? parStrokes - totalPar : null };
  }, [holes]);

  return {
    status: state.status,
    active: state.status === 'active',
    roundId: state.roundId,
    courseId: state.courseId,
    courseName: state.courseName,
    loopKeys: state.loopKeys,
    currentHole: state.currentHole,
    startingHole: state.startingHole,
    holes,
    pendingCount: state.pendingSaves.length,
    ...totals,
    start,
    setHole,
    saveHole,
    finish,
    flush,
  };
}
