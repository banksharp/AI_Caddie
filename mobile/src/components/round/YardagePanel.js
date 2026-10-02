import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from './theme';

const QUALITY = {
  good: { color: '#2DB36F', label: 'Good GPS' },
  fair: { color: '#E9A23B', label: 'Fair GPS' },
  poor: { color: '#E63946', label: 'Weak GPS' },
};

const fmt = (v) => (v == null ? '—' : String(v));

/**
 * Live yardage to the green.
 * state: 'ok' | 'no_green' | 'no_location' | 'locating' | 'away'
 */
function YardagePanel({ state, green, accuracyYds, quality }) {
  if (state === 'no_green') {
    return (
      <View style={s.card}>
        <Text style={s.message}>No green on the map for this hole yet.</Text>
      </View>
    );
  }
  if (state === 'away') {
    return (
      <View style={s.card}>
        <Text style={s.messageTitle}>Not at this course</Text>
        <Text style={s.message}>Live yardage starts when you're on the course. Tap the map to measure.</Text>
      </View>
    );
  }

  const showNumbers = state === 'ok';
  const q = QUALITY[quality] || null;

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={s.side}>
          <Text style={s.sideLabel}>Front</Text>
          <Text style={s.sideValue}>{showNumbers ? fmt(green?.front) : '—'}</Text>
        </View>
        <View style={s.center}>
          <Text style={s.centerValue}>{showNumbers ? fmt(green?.center) : '—'}</Text>
          <Text style={s.centerLabel}>yds to center</Text>
        </View>
        <View style={s.side}>
          <Text style={s.sideLabel}>Back</Text>
          <Text style={s.sideValue}>{showNumbers ? fmt(green?.back) : '—'}</Text>
        </View>
      </View>
      <View style={s.footer}>
        {state === 'no_location' && <Text style={s.footerText}>Location is off</Text>}
        {state === 'locating' && <Text style={s.footerText}>Finding your position…</Text>}
        {state === 'ok' && (
          <>
            {q && <View style={[s.dot, { backgroundColor: q.color }]} />}
            <Text style={s.footerText}>
              {q ? q.label : 'GPS'}
              {accuracyYds != null ? ` · ±${accuracyYds} yds` : ''}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

export default memo(YardagePanel);

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, alignItems: 'center' },
  sideLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  sideValue: { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 2 },
  center: { flex: 1.4, alignItems: 'center' },
  centerValue: { fontSize: 56, fontWeight: '900', color: colors.primary, lineHeight: 62 },
  centerLabel: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footerText: { fontSize: 13, color: colors.muted },
  messageTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4, textAlign: 'center' },
  message: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
