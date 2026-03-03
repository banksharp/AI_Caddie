import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as api from '../../src/api';

function formatVsPar(v) {
  if (v == null) return '-';
  if (v === 0) return 'E';
  if (v > 0) return `+${v}`;
  return String(v);
}

export default function HistoryScreen() {
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadRounds();
    }, [])
  );

  async function loadRounds() {
    setLoading(true);
    try {
      const data = await api.getRounds();
      setRounds(data);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(id) {
    setExpanded(expanded === id ? null : id);
  }

  async function handleDeleteRound(r) {
    Alert.alert(
      'Delete Round',
      `Delete this round at ${r.course_name || 'Unnamed Course'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteRound(r.round_id);
              loadRounds();
              if (expanded === r.round_id) setExpanded(null);
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#2D6A4F" />
      </View>
    );
  }

  if (rounds.length === 0) {
    return (
      <View style={s.center}>
        <Text style={s.emptyIcon}>⛳</Text>
        <Text style={s.emptyText}>No rounds yet</Text>
        <Text style={s.emptySubtext}>Start a round from the Round tab!</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={s.list}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={rounds}
      keyExtractor={(r) => String(r.round_id)}
      renderItem={({ item: r }) => (
        <View style={s.card}>
          <TouchableOpacity onPress={() => toggleExpand(r.round_id)} activeOpacity={0.7}>
            <View style={s.cardHeader}>
              <View>
                <Text style={s.courseName}>{r.course_name || 'Unnamed Course'}</Text>
                <Text style={s.date}>{new Date(r.started_at).toLocaleDateString()}</Text>
              </View>
              <View style={s.headerRight}>
                <View style={s.scoreBadge}>
                  <Text style={s.scoreLabel}>Total</Text>
                  <Text style={s.scoreText}>
                    {r.total_score ?? '-'}
                    {r.total_vs_par != null && ` (${formatVsPar(r.total_vs_par)})`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={s.deleteBtn}
                  onPress={() => handleDeleteRound(r)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="trash-outline" size={22} color="#E63946" />
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>

          {expanded === r.round_id && r.holes.length > 0 && (
            <View style={s.details}>
              <View style={s.detailRow}>
                <Text style={[s.detailCell, s.detailHeader]}>Hole</Text>
                <Text style={[s.detailCell, s.detailHeader]}>Par</Text>
                <Text style={[s.detailCell, s.detailHeader]}>Score</Text>
                <Text style={[s.detailCell, s.detailHeader]}>+/-</Text>
                <Text style={[s.detailCell, s.detailHeader]}>FW</Text>
                <Text style={[s.detailCell, s.detailHeader]}>GIR</Text>
              </View>
              {r.holes.map((h) => (
                <View key={h.hole_number} style={s.detailRow}>
                  <Text style={s.detailCell}>{h.hole_number}</Text>
                  <Text style={s.detailCell}>{h.par ?? '-'}</Text>
                  <Text style={s.detailCell}>{h.strokes}</Text>
                  <Text style={[s.detailCell, h.score_vs_par != null && h.score_vs_par > 0 && s.detailCellOver]}>{formatVsPar(h.score_vs_par)}</Text>
                  <Text style={s.detailCell}>{h.fairway_hit ? '✓' : '-'}</Text>
                  <Text style={s.detailCell}>{h.gir ? '✓' : '-'}</Text>
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total</Text>
                <Text style={s.detailCell}> </Text>
                <Text style={s.totalValue}>{r.total_score ?? '-'}</Text>
                <Text style={s.totalValue}>{r.total_vs_par != null ? formatVsPar(r.total_vs_par) : '-'}</Text>
                <Text style={s.detailCell}> </Text>
                <Text style={s.detailCell}> </Text>
              </View>
            </View>
          )}
        </View>
      )}
    />
  );
}

const s = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#F0F7F4' },
  center: { flex: 1, backgroundColor: '#F0F7F4', justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 20, fontWeight: '700', color: '#1B4332' },
  emptySubtext: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  courseName: { fontSize: 17, fontWeight: '700', color: '#1B4332' },
  date: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoreBadge: { backgroundColor: '#2D6A4F', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  scoreLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase' },
  scoreText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  deleteBtn: { padding: 4 },
  details: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#F0F7F4', paddingTop: 10 },
  detailRow: { flexDirection: 'row', paddingVertical: 6 },
  detailCell: { flex: 1, textAlign: 'center', fontSize: 13, color: '#1B4332' },
  detailCellOver: { color: '#E63946', fontWeight: '700' },
  detailHeader: { fontWeight: '700', color: '#2D6A4F' },
  totalRow: { flexDirection: 'row', paddingVertical: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: '#E5EDE9' },
  totalLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: '#1B4332' },
  totalValue: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#2D6A4F' },
});
