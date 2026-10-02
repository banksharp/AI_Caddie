import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getShotRecommendation } from '../../shotApi';
import { useTournamentMode } from '../../settings';
import { useSubscription } from '../../SubscriptionContext';
import { PaywallScreen } from '../../PaywallScreen';

// "Ask Club Sense" for the current shot. Request/response: docs/gps-contracts.md
// (`shot-recommendation`). Only distances are sent, never coordinates.

const LIES = [
  ['tee', 'Tee'], ['fairway', 'Fairway'], ['first_cut', 'First cut'], ['rough', 'Rough'],
  ['deep_rough', 'Deep rough'], ['sand', 'Sand'], ['hardpan', 'Hardpan'], ['pine_straw', 'Pine straw'],
];
const WINDS = [
  ['calm', 'Calm'], ['into', 'Into'], ['down', 'Down'], ['left_to_right', 'L → R'], ['right_to_left', 'R → L'],
  ['into_left', 'Into, from L'], ['into_right', 'Into, from R'], ['down_left', 'Down, from L'], ['down_right', 'Down, from R'],
];
const WIND_SPEEDS = [5, 10, 15, 20, 25];
const ELEVATIONS = [['flat', 'Flat'], ['uphill', 'Uphill'], ['downhill', 'Downhill']];
const HAZARD_KINDS = ['bunker', 'water', 'lateral_water', 'ob'];
const SHOT_TYPE_LABEL = {
  full: 'Full swing', three_quarter: '3/4 swing', knockdown: 'Knockdown', punch: 'Punch', layup: 'Lay up',
  pitch: 'Pitch', chip: 'Chip', bunker: 'Bunker shot', putt: 'Putt',
};
const RISK_STYLE = {
  low: { bg: '#F0F7F4', fg: '#2D6A4F', label: 'Low risk' },
  medium: { bg: '#FEF3C7', fg: '#B45309', label: 'Medium risk' },
  high: { bg: '#FEE2E2', fg: '#B91C1C', label: 'High risk' },
};
const CHANGED_YDS = 15;
const OFFLINE_RETRY_MS = 8000;

/** Rounded finite number within [min, max], else null. */
function yds(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

function buildPayload({ distances, hole, hazards, gpsAccuracyYds, source, shotNumber, lie, wind, windMph, elevation }) {
  const hz = (Array.isArray(hazards) ? hazards : [])
    .filter((h) => h && HAZARD_KINDS.includes(h.kind))
    // In-play first, then nearest; the server accepts at most 8.
    .sort((a, b) => (b.inPlay === true) - (a.inPlay === true) || (a.reachYds ?? 9999) - (b.reachYds ?? 9999))
    .slice(0, 8)
    .map((h) => ({
      kind: h.kind,
      side: typeof h.side === 'string' ? h.side : null,
      reach_yds: yds(h.reachYds, 0, 1000),
      carry_yds: yds(h.carryYds, 0, 1000),
      lateral_yds: yds(h.lateralYds, -1000, 1000),
      in_play: h.inPlay === true,
    }));

  const front = yds(distances?.front, 1, 750);
  const back = yds(distances?.back, 1, 750);
  const src = source === 'user' ? 'user_pin' : source;

  return {
    distance_to_pin_yds: yds(distances?.center, 1, 700),
    ...(front !== null ? { distance_to_front_yds: front } : {}),
    ...(back !== null ? { distance_to_back_yds: back } : {}),
    hole: {
      number: yds(hole?.number, 1, 36),
      par: yds(hole?.par, 3, 6),
      length_yds: yds(hole?.length_yds, 1, 1000),
    },
    ...(yds(shotNumber, 1, 20) !== null ? { shot_number: Math.round(shotNumber) } : {}),
    lie,
    wind: wind === 'calm' ? { direction: 'calm', strength_mph: 0 } : { direction: wind, strength_mph: windMph },
    elevation,
    hazards: hz,
    ...(yds(gpsAccuracyYds, 0, 10000) !== null ? { gps_accuracy_yds: Math.round(gpsAccuracyYds) } : {}),
    ...(['osm', 'user_pin', 'manual'].includes(src) ? { source: src } : {}),
  };
}

function Chips({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
      {options.map(([key, label]) => (
        <TouchableOpacity
          key={String(key)}
          style={[s.chip, value === key && s.chipActive]}
          onPress={() => onChange(key)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === key }}
        >
          <Text style={[s.chipText, value === key && s.chipTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function Bullets({ items }) {
  return (items || []).map((t, i) => <Text key={i} style={s.bullet}>• {t}</Text>);
}

function AdviceResult({ result }) {
  if (!result?.data) {
    return <Text style={s.resultText}>{result?.advice || 'No advice returned. Please try again.'}</Text>;
  }
  const d = result.data;
  const risk = RISK_STYLE[d.risk?.level] || RISK_STYLE.medium;
  const aim = d.target?.aimSide && d.target.aimSide !== 'center' && d.target.aimOffsetYds
    ? `Aim ${Math.abs(d.target.aimOffsetYds)} yds ${d.target.aimSide} of the pin`
    : 'Aim at the pin';
  const adjusted = d.playsLikeYds !== d.carryNeededYds || (d.playsLikeNotes || []).length > 0;

  return (
    <View style={{ gap: 14 }}>
      <View style={s.clubRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.clubBig}>{d.club}</Text>
          {!!d.alternateClub && <Text style={s.altClub}>or {d.alternateClub}</Text>}
        </View>
        {!!SHOT_TYPE_LABEL[d.shotType] && (
          <View style={s.typePill}><Text style={s.typePillText}>{SHOT_TYPE_LABEL[d.shotType]}</Text></View>
        )}
      </View>

      <View>
        <Text style={s.sectionTitle}>Target</Text>
        {!!d.target?.description && <Text style={s.kvStrong}>{d.target.description}</Text>}
        <Text style={s.note}>{aim}</Text>
      </View>

      <View style={s.statRow}>
        <View style={s.stat}>
          <Text style={s.statLabel}>Carry</Text>
          <Text style={s.statValue}>{d.carryNeededYds}</Text>
        </View>
        {adjusted && (
          <View style={s.stat}>
            <Text style={s.statLabel}>Plays like</Text>
            <Text style={s.statValue}>{d.playsLikeYds}</Text>
          </View>
        )}
      </View>
      {adjusted && <Bullets items={d.playsLikeNotes} />}

      {(d.hazardsInPlay || []).length > 0 && (
        <View>
          <Text style={s.sectionTitle}>In play</Text>
          {d.hazardsInPlay.map((h, i) => (
            <Text key={i} style={s.bullet}>
              • <Text style={s.kvStrong}>{h.hazard}</Text>{h.note ? `: ${h.note}` : ''}
            </Text>
          ))}
        </View>
      )}

      <View>
        <View style={[s.riskBadge, { backgroundColor: risk.bg }]}>
          <Text style={[s.riskText, { color: risk.fg }]}>{risk.label}</Text>
        </View>
        {!!d.risk?.bailout && <Text style={s.kv}>Bailout: <Text style={s.kvStrong}>{d.risk.bailout}</Text></Text>}
        {!!d.risk?.notes && <Text style={s.note}>{d.risk.notes}</Text>}
      </View>

      {(d.why || []).length > 0 && (
        <View>
          <Text style={s.sectionTitle}>Why</Text>
          <Bullets items={d.why} />
        </View>
      )}
    </View>
  );
}

/**
 * Props: { distances: { center, front, back } (yards or null), hole: { number, par, length_yds },
 * hazards: [{ kind, side, reachYds, carryYds, lateralYds, inPlay }], gpsAccuracyYds,
 * gpsQuality: 'good'|'fair'|'poor', source: 'osm'|'user_pin'|'manual', shotNumber }
 */
export default function ShotAdviceCard({
  distances, hole, hazards, gpsAccuracyYds, gpsQuality, source, shotNumber,
}) {
  const router = useRouter();
  const [tournamentMode] = useTournamentMode();
  const { subscriptionActive, loading: subLoading, refreshSubscription } = useSubscription();

  const [lie, setLie] = useState(shotNumber === 1 ? 'tee' : 'fairway');
  const [wind, setWind] = useState('calm');
  const [windMph, setWindMph] = useState(10);
  const [elevation, setElevation] = useState('flat');
  const [result, setResult] = useState(null);
  const [askedAt, setAskedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null); // { message, clubsMissing?, offline? }
  const [offlineUntil, setOfflineUntil] = useState(0);
  const [paywall, setPaywall] = useState(false);
  const requestRef = useRef(0);

  // New hole: drop the previous advice and ignore any reply still in flight.
  useEffect(() => {
    requestRef.current += 1;
    setResult(null);
    setAskedAt(null);
    setError(null);
    setLoading(false);
  }, [hole?.number]);

  // Default the lie from the shot number (tee shot vs. not), keeping a manual choice otherwise.
  useEffect(() => {
    if (shotNumber === 1) setLie('tee');
    else setLie((cur) => (cur === 'tee' ? 'fairway' : cur));
  }, [shotNumber]);

  // Re-enable the button a few seconds after an offline error.
  useEffect(() => {
    if (!offlineUntil) return undefined;
    const t = setTimeout(() => setOfflineUntil(0), Math.max(0, offlineUntil - Date.now()));
    return () => clearTimeout(t);
  }, [offlineUntil]);

  if (tournamentMode) {
    return (
      <View style={s.tournament}>
        <Ionicons name="trophy-outline" size={14} color="#6B7280" />
        <Text style={s.tournamentText}>Tournament mode: distances only</Text>
      </View>
    );
  }

  if (subLoading) {
    return (
      <View style={[s.card, s.centerRow]}>
        <ActivityIndicator color="#2D6A4F" />
      </View>
    );
  }

  if (!subscriptionActive) {
    return (
      <View style={s.card}>
        <View style={s.titleRow}>
          <Ionicons name="lock-closed" size={18} color="#2D6A4F" />
          <Text style={s.cardTitle}>Ask Club Sense</Text>
        </View>
        <Text style={s.hint}>Club, target and risk for this shot from your own distances. Included with Pro.</Text>
        <TouchableOpacity style={s.btn} onPress={() => setPaywall(true)}>
          <Text style={s.btnText}>Unlock with Pro</Text>
        </TouchableOpacity>
        <Text style={s.caption}>{"For casual rounds. Club advice isn't allowed in competition."}</Text>
        <Modal visible={paywall} animationType="slide" onRequestClose={() => setPaywall(false)}>
          <View style={s.paywallModalWrap}>
            <TouchableOpacity style={s.closePaywallBtn} onPress={() => setPaywall(false)}>
              <Text style={s.closePaywallText}>Close</Text>
            </TouchableOpacity>
            <PaywallScreen
              title="Unlock Ask Club Sense"
              subtitle="Subscribe for shot-by-shot club advice on the course."
              onSubscribed={() => setPaywall(false)}
            />
          </View>
        </Modal>
      </View>
    );
  }

  const center = typeof distances?.center === 'number' && Number.isFinite(distances.center)
    ? Math.round(distances.center) : null;
  const offline = offlineUntil > Date.now();
  let disabledReason = null;
  if (center === null) disabledReason = 'Waiting for a GPS distance to the green.';
  else if (center > 700) disabledReason = 'Too far from the green for club advice.';
  else if (center < 1) disabledReason = "You're on the green.";
  else if (offline) disabledReason = 'No connection. Try again in a moment.';
  const distanceChanged = !!result && askedAt !== null && center !== null && Math.abs(center - askedAt) > CHANGED_YDS;

  async function ask() {
    if (disabledReason || loading) return;
    const id = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const payload = buildPayload({
        distances, hole, hazards, gpsAccuracyYds, source, shotNumber, lie, wind, windMph, elevation,
      });
      const data = await getShotRecommendation(payload);
      if (id !== requestRef.current) return;
      setResult(data);
      setAskedAt(center);
    } catch (err) {
      if (id !== requestRef.current) return;
      if (err.code === 'subscription_required') {
        refreshSubscription();
        return;
      }
      if (err.offline) setOfflineUntil(Date.now() + OFFLINE_RETRY_MS);
      setError({
        message: err.message || 'Something went wrong. Please try again.',
        clubsMissing: /club distances/i.test(err.message || ''),
        offline: !!err.offline,
      });
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }

  return (
    <View style={s.card}>
      <View style={s.titleRow}>
        <Ionicons name="sparkles-outline" size={18} color="#2D6A4F" />
        <Text style={s.cardTitle}>Ask Club Sense</Text>
      </View>

      <Text style={s.label}>Lie</Text>
      <Chips options={LIES} value={lie} onChange={setLie} />

      <Text style={s.label}>Wind</Text>
      <Chips options={WINDS} value={wind} onChange={setWind} />
      {wind !== 'calm' && (
        <Chips options={WIND_SPEEDS.map((n) => [n, `${n} mph`])} value={windMph} onChange={setWindMph} />
      )}

      <Text style={s.label}>Elevation</Text>
      <Chips options={ELEVATIONS} value={elevation} onChange={setElevation} />

      {gpsQuality === 'poor' && (
        <View style={s.warn}>
          <Ionicons name="warning-outline" size={16} color="#B45309" />
          <Text style={s.warnText}>
            Weak GPS signal{typeof gpsAccuracyYds === 'number' ? ` (±${Math.round(gpsAccuracyYds)} yds)` : ''}. Distances may be off.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.btn, (disabledReason || loading) && s.btnDisabled]}
        onPress={ask}
        disabled={!!disabledReason || loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.btnText}>{center !== null && !disabledReason ? `Ask Club Sense · ${center} yds` : 'Ask Club Sense'}</Text>}
      </TouchableOpacity>
      {!!disabledReason && <Text style={s.hint}>{disabledReason}</Text>}

      {!!error && !error.offline && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error.message}</Text>
          {error.clubsMissing && (
            <TouchableOpacity onPress={() => router.push('/clubs')}>
              <Text style={s.link}>Set up your distances in My Clubs</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!!result && (
        <View style={s.resultCard}>
          {distanceChanged && (
            <View style={s.warn}>
              <Ionicons name="refresh" size={16} color="#B45309" />
              <Text style={s.warnText}>Distance changed — ask again</Text>
            </View>
          )}
          <Text style={s.resultTitle}>Club Sense says{askedAt !== null ? ` (${askedAt} yds)` : ''}:</Text>
          <AdviceResult result={result} />
        </View>
      )}

      <Text style={s.caption}>{"For casual rounds. Club advice isn't allowed in competition."}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  centerRow: { alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1B4332' },
  label: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6, marginBottom: 6 },
  chipRow: { gap: 8, paddingBottom: 6 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#F0F7F4' },
  chipActive: { backgroundColor: '#2D6A4F' },
  chipText: { fontSize: 14, fontWeight: '600', color: '#1B4332' },
  chipTextActive: { color: '#fff' },
  btn: { backgroundColor: '#2D6A4F', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 12 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 13, color: '#6B7280', lineHeight: 18, marginTop: 8 },
  caption: { fontSize: 12, color: '#9CA3AF', marginTop: 12, textAlign: 'center' },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF3C7', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginTop: 10 },
  warnText: { flex: 1, fontSize: 13, color: '#B45309', fontWeight: '600' },
  errorBox: { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 12 },
  errorText: { fontSize: 14, color: '#B91C1C', lineHeight: 20 },
  link: { fontSize: 14, color: '#2D6A4F', fontWeight: '700', marginTop: 6 },
  tournament: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 },
  tournamentText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  resultCard: { backgroundColor: '#fff', borderRadius: 14, paddingTop: 14, paddingLeft: 14, marginTop: 14, borderLeftWidth: 4, borderLeftColor: '#52B788' },
  resultTitle: { fontSize: 16, fontWeight: '700', color: '#2D6A4F', marginBottom: 10, marginTop: 4 },
  resultText: { fontSize: 15, color: '#374151', lineHeight: 22 },
  clubRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clubBig: { fontSize: 34, fontWeight: '900', color: '#2D6A4F' },
  altClub: { fontSize: 15, fontWeight: '600', color: '#6B7280', marginTop: 2 },
  typePill: { backgroundColor: '#F0F7F4', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10 },
  typePillText: { fontSize: 13, fontWeight: '700', color: '#1B4332' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#1B4332', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: '#F0F7F4', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  statLabel: { fontSize: 12, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 24, fontWeight: '900', color: '#1B4332' },
  riskBadge: { alignSelf: 'flex-start', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 6 },
  riskText: { fontSize: 13, fontWeight: '800' },
  bullet: { fontSize: 15, color: '#374151', lineHeight: 22, marginBottom: 4 },
  kv: { fontSize: 15, color: '#374151', lineHeight: 22 },
  kvStrong: { fontSize: 15, fontWeight: '800', color: '#1B4332' },
  note: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginTop: 4 },
  paywallModalWrap: { flex: 1, backgroundColor: '#F0F7F4' },
  closePaywallBtn: { padding: 16, paddingTop: 48, alignSelf: 'flex-end' },
  closePaywallText: { fontSize: 16, color: '#2D6A4F', fontWeight: '600' },
});
