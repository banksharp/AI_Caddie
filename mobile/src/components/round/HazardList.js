import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from './theme';

const KIND = {
  bunker: { label: 'Bunker', color: '#D9B98C' },
  water: { label: 'Water', color: '#3A86FF' },
  lateral_water: { label: 'Lateral water', color: '#3A86FF' },
  ob: { label: 'OB', color: '#9CA3AF' },
};

export function hazardText(h) {
  const kind = KIND[h.kind]?.label || 'Hazard';
  const side = h.side === 'center' ? 'in line' : h.side;
  if (h.inPlay && h.reachYds != null) {
    const carry = h.carryYds != null ? ` / ${h.carryYds} to carry` : '';
    return `${kind} · ${side} · ${h.reachYds} to reach${carry}`;
  }
  return `${kind} · ${side}${h.distanceYds != null ? ` · ${h.distanceYds} away` : ''}`;
}

/** Hazards for the current shot (output of hazardsForShot), in-play ones first. */
function HazardList({ hazards }) {
  if (!hazards || hazards.length === 0) return null;
  return (
    <View style={s.card}>
      <Text style={s.title}>Hazards</Text>
      {hazards.map((h, i) => (
        <View key={h.id ?? i} style={[s.row, !h.inPlay && s.rowDim]}>
          <View style={[s.swatch, { backgroundColor: KIND[h.kind]?.color || colors.muted }]} />
          <Text style={s.text}>{hazardText(h)}</Text>
        </View>
      ))}
    </View>
  );
}

export default memo(HazardList);

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  title: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  rowDim: { opacity: 0.55 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  text: { flex: 1, fontSize: 15, color: colors.text },
});
