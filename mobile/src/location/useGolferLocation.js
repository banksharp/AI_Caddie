import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';

const MAX_ACCURACY_M = 50;
const UPDATE_INTERVAL_MS = 1000;

function normalizeStatus(s) {
  return s === 'granted' || s === 'denied' ? s : 'undetermined';
}

function toFix(loc) {
  const c = loc?.coords;
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return null;
  const accuracyM = Number.isFinite(c.accuracy) ? c.accuracy : null;
  if (accuracyM != null && accuracyM > MAX_ACCURACY_M) return null;
  return {
    position: [c.latitude, c.longitude],
    accuracyM,
    timestamp: Number.isFinite(loc.timestamp) ? loc.timestamp : Date.now(),
  };
}

/**
 * Foreground-only golfer location while a round screen is open.
 * @param {{ enabled?: boolean }} options
 * @returns {{
 *   status: 'undetermined'|'denied'|'granted',
 *   position: [number, number] | null,
 *   accuracyM: number | null,
 *   ageMs: number | null,
 *   requestPermission: () => Promise<'undetermined'|'denied'|'granted'>,
 *   openSettings: () => Promise<void>,
 * }}
 */
export function useGolferLocation({ enabled = false } = {}) {
  const [status, setStatus] = useState('undetermined');
  const [fix, setFix] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const mounted = useRef(true);
  const lastEmit = useRef(0);
  const pending = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const refreshPermission = useCallback(async () => {
    try {
      const res = await Location.getForegroundPermissionsAsync();
      if (mounted.current) setStatus(normalizeStatus(res.status));
    } catch {
      // keep current status
    }
  }, []);

  // Initial check, and re-check when returning from Settings.
  useEffect(() => {
    refreshPermission();
    const sub = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      if (active) refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  // Throttled state update: at most one per second, trailing edge keeps the latest fix.
  const pushFix = useCallback((next) => {
    if (!next) return;
    pending.current = next;
    const wait = UPDATE_INTERVAL_MS - (Date.now() - lastEmit.current);
    if (wait <= 0) {
      lastEmit.current = Date.now();
      pending.current = null;
      setFix(next);
      setNow(Date.now());
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!mounted.current || !pending.current) return;
        lastEmit.current = Date.now();
        setFix(pending.current);
        setNow(Date.now());
        pending.current = null;
      }, wait);
    }
  }, []);

  const watching = enabled && status === 'granted' && appActive;

  useEffect(() => {
    if (!watching) return undefined;
    let cancelled = false;
    let subscription = null;

    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 60000,
          requiredAccuracy: MAX_ACCURACY_M,
        });
        if (!cancelled) pushFix(toFix(last));
      } catch {
        // no cached fix
      }
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
          (loc) => {
            if (!cancelled) pushFix(toFix(loc));
          }
        );
        if (cancelled) sub.remove();
        else subscription = sub;
      } catch {
        // location services off or unavailable; position stays as is
      }
    })();

    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      pending.current = null;
    };
  }, [watching, pushFix]);

  // 1 s tick so ageMs stays current while enabled.
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  const requestPermission = useCallback(async () => {
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      const s = normalizeStatus(res.status);
      if (mounted.current) setStatus(s);
      return s;
    } catch {
      return 'undetermined';
    }
  }, []);

  const openSettings = useCallback(() => Linking.openSettings(), []);

  return {
    status,
    position: fix ? fix.position : null,
    accuracyM: fix ? fix.accuracyM : null,
    ageMs: fix ? Math.max(0, now - fix.timestamp) : null,
    requestPermission,
    openSettings,
  };
}

export default useGolferLocation;
