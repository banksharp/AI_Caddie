import { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, formatVsPar } from './theme';

/** The round's scorecard. Tapping a row selects that hole (to edit it). */
function Scorecard({ holes, selectedHole, onSelectHole }) {
  if (!holes || holes.length === 0) return null;
  return (
    <View style={s.scorecard}>
      <View style={s.row}>
        {['Hole', 'Par', 'Score', '+/-', 'FW', 'GIR'].map((h) => (
          <Text key={h} style={[s.cell, s.header]}>{h}</Text>
        ))}
      </View>
      {holes.map((h) => (
        <TouchableOpacity
          key={h.hole_number}
          style={[s.row, selectedHole === h.hole_number && s.rowSelected]}
          onPress={onSelectHole ? () => onSelectHole(h.hole_number) : undefined}
          disabled={!onSelectHole}
          activeOpacity={0.6}
        >
          <View style={s.holeCell}>
            <Text style={s.cellText}>{h.hole_number}</Text>
            {h.pending && <Ionicons name="cloud-offline-outline" size={12} color={colors.muted} style={s.pending} />}
          </View>
          <Text style={s.cell}>{h.par ?? '-'}</Text>
          <Text style={s.cell}>{h.strokes}</Text>
          <Text style={[s.cell, h.score_vs_par != null && h.score_vs_par > 0 && s.over]}>{formatVsPar(h.score_vs_par)}</Text>
          <Text style={s.cell}>{h.fairway_hit ? '✓' : '-'}</Text>
          <Text style={s.cell}>{h.gir ? '✓' : '-'}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default memo(Scorecard);

const s = StyleSheet.create({
  scorecard: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.bg },
  rowSelected: { backgroundColor: '#E3F2EA' },
  cell: { flex: 1, textAlign: 'center', paddingVertical: 10, fontSize: 13, color: colors.text },
  holeCell: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  cellText: { fontSize: 13, color: colors.text, paddingVertical: 10 },
  pending: { marginLeft: 3 },
  over: { color: colors.danger, fontWeight: '700' },
  header: { fontWeight: '700', backgroundColor: colors.primary, color: '#fff' },
});
