import { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Modal, StyleSheet,
  ActivityIndicator, Alert, Linking, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getOneShotLocation } from '../../location/getOneShotLocation';
import {
  searchCourses, getCourseDetail, getUserPins, buildHoleModels, loopKeysOf, holesForRound,
} from '../../courseApi';
import { saveCourseCache } from '../../round/roundStore';
import { colors, ui } from './theme';

const BADGE = {
  ready: { text: 'GPS map', bg: '#D8F3DC', fg: colors.primary },
  partial: { text: 'Some holes mapped', bg: '#FEF3C7', fg: '#B45309' },
  other: { text: 'Set greens yourself', bg: '#EEF2F0', fg: colors.muted },
};

const STATUS_NOTE = {
  ready: 'Every hole is on the map.',
  partial: 'Some holes are mapped. You can tap the green on the others.',
  none: 'No hole data yet. Tap each green on the satellite map once and it is saved for next time.',
  fetching: 'The map is still loading. It will appear during your round.',
  error: 'Course map unavailable right now. You can tap each green on the satellite map.',
};

function badgeFor(status) {
  return BADGE[status] || BADGE.other;
}

function place(c) {
  return [c.city, c.region].filter(Boolean).join(', ');
}

function miles(m) {
  if (m == null) return null;
  const mi = m / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

const loopLabel = (k) => {
  if (!k) return 'Main';
  if (k.length === 1) return `Nine ${k.toUpperCase()}`;
  return k.charAt(0).toUpperCase() + k.slice(1);
};

/**
 * Find a course and set up a GPS round.
 * onStart({ courseName, courseId, loopKeys, startingHole }) starts the round.
 */
export default function CoursePicker({ visible, onClose, onStart }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [degraded, setDegraded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [explainLocation, setExplainLocation] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  // Setup step for the chosen course.
  const [course, setCourse] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pins, setPins] = useState([]);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [loops, setLoops] = useState([]);
  const [chosenLoops, setChosenLoops] = useState([]);
  const [startingHole, setStartingHole] = useState(1);
  const [starting, setStarting] = useState(false);
  const chosenIdRef = useRef(null);

  function reset() {
    chosenIdRef.current = null;
    setLoadingCourse(false);
    setCourse(null);
    setDetail(null);
    setPins([]);
    setLoops([]);
    setChosenLoops([]);
    setStartingHole(1);
  }

  function close() {
    reset();
    setExplainLocation(false);
    onClose();
  }

  async function runSearch(params) {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchCourses(params);
      setResults(res.courses);
      setDegraded(res.degraded);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function nearMe() {
    let status = 'undetermined';
    try {
      ({ status } = await Location.getForegroundPermissionsAsync());
    } catch {}
    if (status === 'undetermined') {
      setExplainLocation(true); // explain first; the system prompt comes after "Continue"
      return;
    }
    await locateAndSearch();
  }

  async function locateAndSearch() {
    setExplainLocation(false);
    setSearching(true);
    setLocationDenied(false);
    const p = await getOneShotLocation();
    if (!p) {
      setSearching(false);
      let status = 'undetermined';
      try {
        ({ status } = await Location.getForegroundPermissionsAsync());
      } catch {}
      if (status === 'denied') setLocationDenied(true);
      else setSearchError("Couldn't get your location. Try searching by name.");
      return;
    }
    await runSearch({ lat: p[0], lng: p[1] });
  }

  function submitQuery() {
    const q = query.trim();
    if (q.length < 2) {
      Alert.alert('Search', 'Type at least 2 letters of the course name.');
      return;
    }
    runSearch({ query: q });
  }

  async function chooseCourse(c) {
    setCourse(c);
    chosenIdRef.current = c.id;
    setLoadingCourse(true);
    const [d, p] = await Promise.allSettled([getCourseDetail(c.id), getUserPins(c.id)]);
    if (chosenIdRef.current !== c.id) return; // went back or picked another course
    const det = d.status === 'fulfilled'
      ? d.value
      : { course: null, status: 'error', holes: [], unassigned_greens: [], error: d.reason?.message };
    const pinRows = p.status === 'fulfilled' ? p.value : [];
    setDetail(det);
    setPins(pinRows);
    const keys = loopKeysOf(buildHoleModels(det, pinRows));
    setLoops(keys);
    setChosenLoops(keys.length > 1 ? keys.slice(0, 2) : []);
    setLoadingCourse(false);
  }

  function toggleLoop(k) {
    setChosenLoops((cur) => {
      if (cur.includes(k)) return cur.filter((x) => x !== k);
      return cur.length >= 2 ? [cur[1], k] : [...cur, k];
    });
  }

  const multiLoop = !loadingCourse && loops.length > 1;
  const models = detail ? buildHoleModels(detail, pins) : [];
  const roundHoleCount = detail ? holesForRound(models, multiLoop ? chosenLoops : null).length : 18;
  const canStartAt10 = roundHoleCount >= 10;

  async function start() {
    if (multiLoop && chosenLoops.length === 0) {
      Alert.alert('Choose nines', 'Pick the nine (or two) you are playing.');
      return;
    }
    setStarting(true);
    try {
      // Cache the course for offline play before the round opens.
      if (detail && detail.status !== 'error') await saveCourseCache(course.id, { detail, pins });
      await onStart({
        courseName: course.name,
        courseId: course.id,
        loopKeys: multiLoop ? chosenLoops : null,
        startingHole: canStartAt10 ? startingHole : 1,
      });
      reset();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={s.container}>
        <View style={s.header}>
          {course ? (
            <TouchableOpacity onPress={reset} style={s.headerBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.primary} />
              <Text style={s.headerBtnText}>Courses</Text>
            </TouchableOpacity>
          ) : <View style={s.headerBtn} />}
          <Text style={s.headerTitle}>{course ? 'Set up round' : 'Find a course'}</Text>
          <TouchableOpacity onPress={close} style={[s.headerBtn, s.headerRight]}>
            <Text style={s.headerBtnText}>Close</Text>
          </TouchableOpacity>
        </View>

        {!course ? (
          <View style={s.body}>
            <TouchableOpacity style={[ui.btn, s.row]} onPress={nearMe} disabled={searching}>
              <Ionicons name="navigate" size={18} color="#fff" />
              <Text style={ui.btnText}>Courses near me</Text>
            </TouchableOpacity>

            {explainLocation && (
              <View style={s.explain}>
                <Text style={s.explainTitle}>Use your location?</Text>
                <Text style={ui.hint}>
                  Club Sense uses your approximate location once to find golf courses nearby. It isn't stored.
                  During a round it shows your yardage; location stays on your phone.
                </Text>
                <View style={s.explainButtons}>
                  <TouchableOpacity style={[ui.btnSecondary, s.flex]} onPress={() => setExplainLocation(false)}>
                    <Text style={ui.btnSecondaryText}>Not now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[ui.btn, s.flex]} onPress={locateAndSearch}>
                    <Text style={ui.btnText}>Continue</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {locationDenied && (
              <View style={s.explain}>
                <Text style={ui.hint}>Location is off for Club Sense. Search by name, or turn it on in Settings.</Text>
                <TouchableOpacity style={[ui.btnSecondary, s.mt]} onPress={() => Linking.openSettings()}>
                  <Text style={ui.btnSecondaryText}>Open Settings</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={s.searchRow}>
              <TextInput
                style={[ui.input, s.searchInput]}
                placeholder="Search by course name"
                placeholderTextColor={colors.placeholder}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                onSubmitEditing={submitQuery}
                autoCorrect={false}
              />
              <TouchableOpacity style={s.searchBtn} onPress={submitQuery} disabled={searching}>
                <Ionicons name="search" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {searching && <ActivityIndicator color={colors.primary} style={s.mt} />}
            {!!searchError && !searching && <Text style={s.error}>{searchError}</Text>}
            {degraded && !searching && (
              <Text style={s.note}>Course search is busy right now, so only saved courses are shown.</Text>
            )}

            {results && !searching && (
              <FlatList
                data={results}
                keyExtractor={(c) => String(c.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={s.list}
                ListEmptyComponent={<Text style={s.note}>No courses found. Try another name.</Text>}
                renderItem={({ item: c }) => {
                  const b = badgeFor(c.hole_data_status);
                  return (
                    <TouchableOpacity style={s.result} onPress={() => chooseCourse(c)}>
                      <View style={s.flex}>
                        <Text style={s.resultName}>{c.name}</Text>
                        <Text style={s.resultMeta}>
                          {[place(c), miles(c.distance_m)].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <View style={[s.badge, { backgroundColor: b.bg }]}>
                        <Text style={[s.badgeText, { color: b.fg }]}>{b.text}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        ) : (
          <ScrollView style={s.body} contentContainerStyle={s.list}>
            <View style={ui.card}>
              <Text style={s.courseName}>{course.name}</Text>
              {!!place(course) && <Text style={s.resultMeta}>{place(course)}</Text>}
              {loadingCourse ? (
                <View style={[s.row, s.mt]}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[ui.hint, s.flex]}>Downloading course map… The first time can take up to a minute.</Text>
                </View>
              ) : (
                <Text style={[ui.hint, s.mt]}>{STATUS_NOTE[detail?.status] || STATUS_NOTE.none}</Text>
              )}
            </View>

            {!loadingCourse && multiLoop && (
              <View style={ui.card}>
                <Text style={s.sectionTitle}>Which nines?</Text>
                <Text style={[ui.hint, s.mb]}>Pick one or two, in the order you'll play them.</Text>
                <View style={s.wrap}>
                  {loops.map((k) => {
                    const idx = chosenLoops.indexOf(k);
                    const on = idx >= 0;
                    return (
                      <TouchableOpacity key={k} style={[s.loopChip, on && ui.chipActive]} onPress={() => toggleLoop(k)}>
                        <Text style={[ui.chipText, on && ui.chipTextActive]}>
                          {on ? `${idx + 1}. ` : ''}{loopLabel(k)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={ui.card}>
              <Text style={s.sectionTitle}>Starting hole</Text>
              <View style={ui.chipRow}>
                {[1, 10].map((n) => {
                  const disabled = n === 10 && !canStartAt10;
                  const on = (canStartAt10 ? startingHole : 1) === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      style={[ui.chip, on && ui.chipActive, disabled && s.disabled]}
                      onPress={() => setStartingHole(n)}
                      disabled={disabled}
                    >
                      <Text style={[ui.chipText, on && ui.chipTextActive]}>Hole {n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity style={[ui.btn, starting && s.disabled]} onPress={start} disabled={starting}>
              <Text style={ui.btnText}>{starting ? 'Starting...' : loadingCourse ? 'Start without waiting' : 'Start Round'}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 14, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  headerBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 90 },
  headerRight: { justifyContent: 'flex-end' },
  headerBtnText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  body: { flex: 1, padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center' },
  list: { paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  flex: { flex: 1 },
  mt: { marginTop: 12 },
  mb: { marginBottom: 10 },
  explain: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 12 },
  explainTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  explainButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  searchInput: { flex: 1, backgroundColor: '#fff', marginBottom: 0 },
  searchBtn: { backgroundColor: colors.primary, borderRadius: 10, width: 50, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, marginTop: 12, fontSize: 14 },
  note: { color: colors.muted, marginTop: 12, fontSize: 14 },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14,
    padding: 14, marginTop: 10,
  },
  resultName: { fontSize: 16, fontWeight: '700', color: colors.text },
  resultMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  courseName: { fontSize: 20, fontWeight: '800', color: colors.text },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  loopChip: { backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  disabled: { opacity: 0.4 },
});
