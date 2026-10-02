import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-only settings. Contract: docs/gps-contracts.md (Tournament mode).
const TOURNAMENT_KEY = 'settings:tournamentMode';

let tournamentMode = false;
let loaded = false;
let loadPromise = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(tournamentMode));
}

function loadTournamentMode() {
  if (loaded) return Promise.resolve(tournamentMode);
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(TOURNAMENT_KEY)
      .then((v) => { tournamentMode = v === '1'; })
      .catch(() => {})
      .then(() => {
        loaded = true;
        notify();
        return tournamentMode;
      });
  }
  return loadPromise;
}

/** Sets Tournament mode for every mounted screen and saves it on the device. */
export async function setTournamentMode(enabled) {
  tournamentMode = !!enabled;
  loaded = true;
  notify();
  try {
    await AsyncStorage.setItem(TOURNAMENT_KEY, tournamentMode ? '1' : '0');
  } catch {
    // Keep the in-memory value; it will be retried the next time the switch changes.
  }
}

/**
 * [enabled, setEnabled] for Tournament mode (hides "Ask Club Sense"; distances only).
 * All screens using the hook update together.
 */
export function useTournamentMode() {
  const [enabled, setEnabledState] = useState(tournamentMode);

  useEffect(() => {
    listeners.add(setEnabledState);
    setEnabledState(tournamentMode);
    loadTournamentMode();
    return () => { listeners.delete(setEnabledState); };
  }, []);

  const setEnabled = useCallback((value) => setTournamentMode(value), []);
  return [enabled, setEnabled];
}
