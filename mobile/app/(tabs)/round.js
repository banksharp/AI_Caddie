import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useRoundSession } from '../../src/round/useRoundSession';
import { loadCourseCache, saveCourseCache } from '../../src/round/roundStore';
import {
  getCourseDetail, getUserPins, saveUserPin, buildHoleModels, holesForRound,
} from '../../src/courseApi';
import { useGolferLocation } from '../../src/location/useGolferLocation';
import {
  distanceSummary, isNearCourse, gpsQuality, yardsBetween,
} from '../../src/geo/distance';
import { createHoleDetectionState, suggestHole } from '../../src/geo/holeDetection';
import RoundStart from '../../src/components/round/RoundStart';
import HoleMapView from '../../src/components/round/HoleMapView';
import HoleNavigator from '../../src/components/round/HoleNavigator';
import YardagePanel from '../../src/components/round/YardagePanel';
import HazardList from '../../src/components/round/HazardList';
import PinSetupBar from '../../src/components/round/PinSetupBar';
import ScoreEntryCard from '../../src/components/round/ScoreEntryCard';
import Scorecard from '../../src/components/round/Scorecard';
import ShotAdviceCard from '../../src/components/round/ShotAdviceCard';
import { colors, formatVsPar } from '../../src/components/round/theme';

const isPoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const EMPTY_SUMMARY = { green: null, hazards: [] };

// ── Helpers ──

/** Hole numbers in playing order (rotated to start at the starting hole). */
function playOrder(sortedNumbers, startingHole) {
  const i = sortedNumbers.indexOf(startingHole);
  return i > 0 ? [...sortedNumbers.slice(i), ...sortedNumbers.slice(0, i)] : sortedNumbers;
}

/** The next hole after `current` in playing order that has no score yet, or null. */
function nextUnscored(order, current, scored) {
  const idx = order.indexOf(current);
  for (let i = 1; i <= order.length; i += 1) {
    const n = order[(idx + i + order.length) % order.length];
    if (!scored.has(n)) return n;
  }
  return null;
}

function stepHole(sortedNumbers, current, delta) {
  if (sortedNumbers.length === 0) return null;
  const idx = sortedNumbers.indexOf(current);
  if (idx < 0) return sortedNumbers[0];
  return sortedNumbers[(idx + delta + sortedNumbers.length) % sortedNumbers.length];
}

const pinKey = (p) => `${p.loop_key || ''}|${p.hole_number}`;
function mergePins(base, overrides) {
  const map = new Map((base || []).map((p) => [pinKey(p), p]));
  for (const p of overrides || []) map.set(pinKey(p), p);
  return [...map.values()];
}

function pinArgs(row) {
  const pt = (a, b) => (row[a] != null && row[b] != null ? [row[a], row[b]] : null);
  return {
    loopKey: row.loop_key || '',
    holeNumber: row.hole_number,
    par: row.par,
    center: pt('green_center_lat', 'green_center_lng'),
    front: pt('green_front_lat', 'green_front_lng'),
    back: pt('green_back_lat', 'green_back_lng'),
    tee: pt('tee_lat', 'tee_lng'),
  };
}

function isNetworkError(err) {
  return /network|fetch|timed? ?out|offline|load failed|connection|internet/i.test(String(err?.message || ''));
}

/** Course center/bbox for isNearCourse when the server has no course row (from hole points). */
function deriveCourse(models) {
  const pts = [];
  for (const h of models) {
    if (isPoint(h.tee)) pts.push(h.tee);
    if (isPoint(h.green?.center)) pts.push(h.green.center);
  }
  if (pts.length === 0) return null;
  return {
    center_lat: pts.reduce((s, p) => s + p[0], 0) / pts.length,
    center_lng: pts.reduce((s, p) => s + p[1], 0) / pts.length,
  };
}

// ── Course data (cache first, then network; pins saved offline sync later) ──

function useCourseData(courseId) {
  const [state, setState] = useState({ detail: null, pins: [], loading: true, error: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(true);
  const localEditsRef = useRef(new Map()); // pins saved this session win over older loads
  const pollRef = useRef({ timer: null, count: 0 });
  useEffect(() => () => {
    mountedRef.current = false;
    clearTimeout(pollRef.current.timer);
  }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (courseId == null) return;
    setState((s) => ({ ...s, loading: true }));
    const cached = await loadCourseCache(courseId);
    if (cached && mountedRef.current) {
      setState((s) => ({ ...s, detail: s.detail || cached.detail, pins: s.pins.length ? s.pins : cached.pins || [] }));
    }

    const onProgress = (partial) => {
      // Still fetching but some holes are known: show them meanwhile.
      if (mountedRef.current) setState((s) => ({ ...s, detail: partial }));
    };
    const [d, p] = await Promise.allSettled([
      getCourseDetail(courseId, { refresh, onProgress }),
      getUserPins(courseId),
    ]);
    let detail = d.status === 'fulfilled' ? d.value : null;
    // Offline or a server error: keep the cached geometry if there is any.
    if (!detail || ((detail.status === 'error' || detail.holes.length === 0) && cached?.detail?.holes?.length)) {
      detail = cached?.detail ?? detail;
    }

    const localPins = mergePins(cached?.pins, stateRef.current.pins);
    let pins = localPins;
    if (p.status === 'fulfilled') {
      const unsynced = localPins.filter((x) => x._unsynced);
      pins = mergePins(p.value, unsynced);
      for (const u of unsynced) {
        try {
          const row = await saveUserPin(courseId, pinArgs(u));
          pins = mergePins(pins, [row]);
          if (localEditsRef.current.has(pinKey(row))) localEditsRef.current.set(pinKey(row), row);
        } catch {}
      }
    }

    if (!mountedRef.current) return;
    pins = mergePins(pins, [...localEditsRef.current.values()]);
    setState({
      detail,
      pins,
      loading: false,
      error: !detail && d.status === 'rejected' ? d.reason?.message || 'Could not load the course' : null,
    });
    if (detail || pins.length) saveCourseCache(courseId, { detail, pins });

    // The server is still downloading the course: check again a few times.
    clearTimeout(pollRef.current.timer);
    if (detail?.status === 'fetching' && pollRef.current.count < 4) {
      pollRef.current.count += 1;
      pollRef.current.timer = setTimeout(() => loadRef.current?.(), 15000);
    }
  }, [courseId]);
  const loadRef = useRef(null);
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [load]);

  const upsertPin = useCallback((row) => {
    localEditsRef.current.set(pinKey(row), row);
    const pins = mergePins(stateRef.current.pins, [row]);
    setState((s) => ({ ...s, pins }));
    saveCourseCache(courseId, { detail: stateRef.current.detail, pins });
  }, [courseId]);

  return { ...state, reload: load, upsertPin };
}

// ── Shared scoring actions ──

function useScoring({ saveHole, setHole, finish, pendingCount }, order, scoredNumbers) {
  const onSave = useCallback(async (holeData) => {
    await saveHole(holeData);
    const scored = new Set(scoredNumbers);
    scored.add(holeData.hole_number);
    const next = nextUnscored(order, holeData.hole_number, scored);
    if (next != null) setHole(next);
  }, [saveHole, setHole, order, scoredNumbers]);

  const doFinish = useCallback(async (force = false) => {
    try {
      await finish({ force });
      Alert.alert('Round Complete', 'Your round has been saved!');
    } catch (err) {
      Alert.alert(
        "Couldn't finish the round",
        `${err.message}\n\nFinish anyway? Scores that haven't synced yet will be lost.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Finish anyway', style: 'destructive', onPress: () => doFinish(true) },
        ],
      );
    }
  }, [finish]);

  const confirmFinish = useCallback(() => {
    Alert.alert(
      'Finish Round',
      pendingCount > 0
        ? 'Some scores are still waiting for a connection. Finish now and they will be sent first.'
        : 'Finish and save this round?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Finish', onPress: () => doFinish(false) },
      ],
    );
  }, [doFinish, pendingCount]);

  return { onSave, confirmFinish };
}

function RoundHeader({ courseName, totalScore, totalVsPar, pendingCount }) {
  return (
    <>
      <View style={s.header}>
        <Text style={s.headerTitle} numberOfLines={1}>{courseName || 'Round'}</Text>
        {totalScore != null && (
          <Text style={s.headerScore}>
            Total: {totalScore}
            {totalVsPar != null && ` (${formatVsPar(totalVsPar)})`}
          </Text>
        )}
      </View>
      {pendingCount > 0 && (
        <View style={s.syncBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
          <Text style={s.syncText}>
            {pendingCount === 1 ? '1 score is' : `${pendingCount} scores are`} saved on this phone and will sync when you're back online.
          </Text>
        </View>
      )}
    </>
  );
}

// ── Score-only round (no course) ──

function ScoreOnlyRound({ session }) {
  const { currentHole, startingHole, holes, setHole } = session;
  const scoredNumbers = useMemo(() => holes.map((h) => h.hole_number), [holes]);
  const scored = useMemo(() => new Set(scoredNumbers), [scoredNumbers]);
  const numbers = useMemo(() => {
    const max = Math.max(18, currentHole, ...scoredNumbers.map((n) => n + 1));
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [currentHole, scoredNumbers]);
  const order = useMemo(() => playOrder(numbers, startingHole), [numbers, startingHole]);
  const { onSave, confirmFinish } = useScoring(session, order, scoredNumbers);
  const existing = holes.find((h) => h.hole_number === currentHole) || null;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <RoundHeader
        courseName={session.courseName}
        totalScore={session.totalScore}
        totalVsPar={session.totalVsPar}
        pendingCount={session.pendingCount}
      />
      <HoleNavigator
        holeNumber={currentHole}
        par={existing?.par ?? null}
        lengthYds={null}
        holeNumbers={numbers}
        scored={scored}
        onSelectHole={setHole}
        onPrev={currentHole > 1 ? () => setHole(currentHole - 1) : null}
        onNext={() => setHole(currentHole + 1)}
      />
      <Scorecard holes={holes} selectedHole={currentHole} onSelectHole={setHole} />
      <ScoreEntryCard holeNumber={currentHole} defaultPar={null} existing={existing} onSave={onSave} />
      <TouchableOpacity style={s.endBtn} onPress={confirmFinish}>
        <Text style={s.endBtnText}>{holes.length > 0 ? 'Finish Round' : 'End Round'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── GPS round ──

function GpsRound({ session, focused }) {
  const { courseId, loopKeys, currentHole, startingHole, holes: scoredRows, setHole } = session;
  const course = useCourseData(courseId);
  const { upsertPin } = course;

  const models = useMemo(() => buildHoleModels(course.detail, course.pins), [course.detail, course.pins]);
  const playHoles = useMemo(() => holesForRound(models, loopKeys), [models, loopKeys]);
  const numbers = useMemo(() => playHoles.map((h) => h.hole_number).sort((a, b) => a - b), [playHoles]);
  const order = useMemo(() => playOrder(numbers, startingHole), [numbers, startingHole]);
  const scoredNumbers = useMemo(() => scoredRows.map((h) => h.hole_number), [scoredRows]);
  const scored = useMemo(() => new Set(scoredNumbers), [scoredNumbers]);
  const { onSave, confirmFinish } = useScoring(session, order, scoredNumbers);

  const hole = playHoles.find((h) => h.hole_number === currentHole) || null;
  const holeNumber = hole ? hole.hole_number : currentHole;

  // The saved current hole isn't on this course's list (e.g. resumed from the server).
  useEffect(() => {
    if (course.loading || numbers.length === 0 || numbers.includes(currentHole)) return;
    setHole(nextUnscored(order, order[order.length - 1], scored) ?? order[0]);
  }, [course.loading, numbers, order, currentHole, scored, setHole]);

  // ── Location (only while this tab is focused) ──
  const loc = useGolferLocation({ enabled: focused });
  const [explainReady, setExplainReady] = useState(false);
  const [explainDismissed, setExplainDismissed] = useState(false);
  useEffect(() => {
    // Wait for the permission check so the explainer doesn't flash.
    const t = setTimeout(() => setExplainReady(true), 800);
    return () => clearTimeout(t);
  }, []);

  const courseInfo = useMemo(() => course.detail?.course || deriveCourse(models), [course.detail, models]);
  const fallbackCenter = useMemo(
    () => (courseInfo && Number.isFinite(courseInfo.center_lat) ? [courseInfo.center_lat, courseInfo.center_lng] : null),
    [courseInfo],
  );
  const position = loc.position;
  const nearCourse = position ? (courseInfo ? isNearCourse(position, courseInfo) : true) : false;
  const golfer = nearCourse ? position : null;

  const hasGreen = isPoint(hole?.green?.center);
  const summary = useMemo(
    () => (golfer && hole ? distanceSummary(golfer, hole) : EMPTY_SUMMARY),
    [golfer, hole],
  );
  const accuracyYds = loc.accuracyM != null ? Math.round(loc.accuracyM / 0.9144) : null;
  const quality = position ? gpsQuality(loc.accuracyM, loc.ageMs) : null;

  let yardageState = 'ok';
  if (!hasGreen) yardageState = 'no_green';
  else if (loc.status !== 'granted') yardageState = 'no_location';
  else if (!position) yardageState = 'locating';
  else if (!nearCourse) yardageState = 'away';

  const shotNumber = golfer && isPoint(hole?.tee) && (yardsBetween(golfer, hole.tee) ?? 999) < 30 ? 1 : 2;

  // ── Pins ──
  const [pinMode, setPinMode] = useState(false);
  const [pinSkipped, setPinSkipped] = useState(false);
  const [pendingCenter, setPendingCenter] = useState(null);
  const effectivePinMode = pinMode || (!hasGreen && !pinSkipped && !course.loading);

  // ── Hole suggestion ──
  const detectRef = useRef(createHoleDetectionState());
  const dismissedRef = useRef(new Set());
  const [suggestion, setSuggestion] = useState(null);

  useEffect(() => {
    setPinMode(false);
    setPinSkipped(false);
    setPendingCenter(null);
    setSuggestion(null);
    dismissedRef.current = new Set();
    detectRef.current = createHoleDetectionState();
  }, [holeNumber]);

  useEffect(() => {
    if (!golfer || effectivePinMode) return;
    const sug = suggestHole(golfer, playHoles, holeNumber, scoredNumbers, detectRef.current);
    if (sug && sug.holeNumber !== holeNumber && !dismissedRef.current.has(sug.holeNumber)) {
      setSuggestion(sug);
    }
    // Run once per GPS fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [golfer]);

  const savePin = useCallback(async ({ par }) => {
    if (!hole || !pendingCenter) return;
    const args = {
      loopKey: hole.loop_key || '',
      holeNumber: hole.course_hole_number ?? hole.hole_number,
      par,
      center: pendingCenter,
      tee: isPoint(hole.tee) ? hole.tee : null,
    };
    try {
      const row = await saveUserPin(courseId, args);
      upsertPin(row);
    } catch (err) {
      if (!isNetworkError(err)) {
        Alert.alert('Error', err.message);
        return;
      }
      upsertPin({
        course_id: courseId,
        loop_key: args.loopKey,
        hole_number: args.holeNumber,
        par,
        green_center_lat: pendingCenter[0],
        green_center_lng: pendingCenter[1],
        green_front_lat: null,
        green_front_lng: null,
        green_back_lat: null,
        green_back_lng: null,
        tee_lat: args.tee ? args.tee[0] : null,
        tee_lng: args.tee ? args.tee[1] : null,
        _unsynced: true,
      });
      Alert.alert('Saved on this phone', "No connection right now. The green will be saved to your account when you're back online.");
    }
    setPinMode(false);
    setPendingCenter(null);
  }, [hole, pendingCenter, courseId, upsertPin]);

  const cancelPin = useCallback(() => {
    setPinMode(false);
    setPinSkipped(true);
    setPendingCenter(null);
  }, []);

  const existing = scoredRows.find((h) => h.hole_number === holeNumber) || null;
  const status = course.detail?.status;

  return (
    <View style={s.gpsWrap}>
      <HoleMapView
        style={s.map}
        hole={hole}
        golfer={golfer}
        fallbackCenter={fallbackCenter}
        pinMode={effectivePinMode}
        pendingCenter={pendingCenter}
        onPlaceGreen={setPendingCenter}
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.panelContent}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <RoundHeader
          courseName={session.courseName}
          totalScore={session.totalScore}
          totalVsPar={session.totalVsPar}
          pendingCount={session.pendingCount}
        />

        {explainReady && loc.status === 'undetermined' && !explainDismissed && (
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>Turn on location for live yardage</Text>
            <Text style={s.infoText}>
              Club Sense uses your location while this screen is open to show distances to the green and
              hazards. It stays on your phone.
            </Text>
            <View style={s.infoButtons}>
              <TouchableOpacity style={s.secondaryBtn} onPress={() => setExplainDismissed(true)}>
                <Text style={s.secondaryBtnText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.primaryBtn} onPress={loc.requestPermission}>
                <Text style={s.primaryBtnText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loc.status === 'denied' && (
          <View style={s.warnBanner}>
            <Ionicons name="location-outline" size={18} color="#B45309" />
            <Text style={s.warnText}>Location is off. You can still tap the map to measure.</Text>
            <TouchableOpacity onPress={loc.openSettings}>
              <Text style={s.warnLink}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        {course.loading && !course.detail && (
          <View style={s.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[s.infoText, { flex: 1 }]}>Downloading course map… The first time can take up to a minute.</Text>
          </View>
        )}
        {!course.loading && status === 'fetching' && (
          <View style={s.warnBanner}>
            <Text style={s.warnText}>The course map is still loading.</Text>
            <TouchableOpacity onPress={() => course.reload()}>
              <Text style={s.warnLink}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!course.loading && (course.error || status === 'error') && (
          <View style={s.warnBanner}>
            <Text style={s.warnText}>Couldn't load the course map. You can tap each green yourself.</Text>
            <TouchableOpacity onPress={() => course.reload()}>
              <Text style={s.warnLink}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        <HoleNavigator
          holeNumber={holeNumber}
          par={hole?.par ?? existing?.par ?? null}
          lengthYds={hole?.length_yds ?? null}
          holeNumbers={numbers}
          scored={scored}
          onSelectHole={setHole}
          onPrev={numbers.length > 1 ? () => setHole(stepHole(numbers, holeNumber, -1)) : null}
          onNext={numbers.length > 1 ? () => setHole(stepHole(numbers, holeNumber, 1)) : null}
          suggestion={suggestion}
          onAcceptSuggestion={() => suggestion && setHole(suggestion.holeNumber)}
          onDismissSuggestion={() => {
            if (suggestion) dismissedRef.current.add(suggestion.holeNumber);
            setSuggestion(null);
          }}
        />

        {effectivePinMode && hole && (
          <PinSetupBar
            holeNumber={holeNumber}
            hasGreen={hasGreen}
            pinMode
            pendingCenter={pendingCenter}
            defaultPar={hole.par}
            onCancel={cancelPin}
            onSave={savePin}
          />
        )}

        <YardagePanel state={yardageState} green={summary.green} accuracyYds={accuracyYds} quality={quality} />
        <HazardList hazards={summary.hazards} />

        {hasGreen && golfer && (
          <ShotAdviceCard
            distances={summary.green}
            hole={{ number: holeNumber, par: hole?.par ?? null, length_yds: hole?.length_yds ?? null }}
            hazards={summary.hazards}
            gpsAccuracyYds={accuracyYds}
            gpsQuality={quality}
            source={hole?.source === 'user' ? 'user_pin' : 'osm'}
            shotNumber={shotNumber}
          />
        )}

        {!effectivePinMode && hole && (
          <PinSetupBar
            holeNumber={holeNumber}
            hasGreen={hasGreen}
            pinMode={false}
            onStartEdit={() => setPinMode(true)}
          />
        )}

        <ScoreEntryCard holeNumber={holeNumber} defaultPar={hole?.par ?? null} existing={existing} onSave={onSave} />
        <Scorecard holes={scoredRows} selectedHole={holeNumber} onSelectHole={setHole} />

        <TouchableOpacity style={s.endBtn} onPress={confirmFinish}>
          <Text style={s.endBtnText}>{scoredRows.length > 0 ? 'Finish Round' : 'End Round'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── Screen ──

export default function RoundScreen() {
  const session = useRoundSession();
  const [focused, setFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  if (session.status === 'loading') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!session.active) return <RoundStart onStart={session.start} />;
  if (session.courseId != null) return <GpsRound session={session} focused={focused} />;
  return <ScoreOnlyRound session={session} />;
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  gpsWrap: { flex: 1, backgroundColor: colors.bg },
  map: { height: '55%' },
  scroll: { flex: 1, backgroundColor: colors.bg },
  // Content is capped on iPad; the map stays full width.
  scrollContent: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  panelContent: { padding: 12, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.text },
  headerScore: { fontSize: 18, fontWeight: '700', color: colors.primary },
  syncBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 12 },
  syncText: { flex: 1, fontSize: 13, color: colors.muted },
  infoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: colors.primarySoft },
  infoTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  infoText: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  infoButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 12, alignItems: 'center' },
  secondaryBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 12 },
  warnText: { flex: 1, fontSize: 13, color: '#92400E' },
  warnLink: { fontSize: 13, fontWeight: '800', color: colors.primary },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  endBtn: { backgroundColor: colors.danger, borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 },
  endBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
