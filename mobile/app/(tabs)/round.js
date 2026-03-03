import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  ScrollView, StyleSheet, Alert,
} from 'react-native';
import * as api from '../../src/api';

export default function RoundScreen() {
  const [roundId, setRoundId] = useState(null);
  const [courseName, setCourseName] = useState('');
  const [holes, setHoles] = useState([]);
  const [totalScore, setTotalScore] = useState(null);
  const [totalVsPar, setTotalVsPar] = useState(null);

  // Hole entry
  const [par, setPar] = useState(4);
  const [strokes, setStrokes] = useState('');
  const [fairway, setFairway] = useState(false);
  const [gir, setGir] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleStartRound() {
    if (!courseName.trim()) return Alert.alert('Error', 'Please enter a course name');
    setBusy(true);
    try {
      const data = await api.startRound(courseName);
      setRoundId(data.round_id);
      setHoles([]);
      setTotalScore(null);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddHole() {
    if (!strokes) return Alert.alert('Error', 'Please enter strokes');
    setBusy(true);
    try {
      const data = await api.addHole(roundId, {
        hole_number: holes.length + 1,
        par,
        strokes: parseInt(strokes),
        fairway_hit: fairway,
        gir,
        notes: notes || null,
      });
      setHoles(data.holes);
      setTotalScore(data.total_score);
      setTotalVsPar(data.total_vs_par ?? null);
      setStrokes('');
      setFairway(false);
      setGir(false);
      setNotes('');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setBusy(false);
    }
  }

  function formatVsPar(v) {
    if (v == null) return '-';
    if (v === 0) return 'E';
    if (v > 0) return `+${v}`;
    return String(v);
  }

  function endRound() {
    setRoundId(null);
    setCourseName('');
    setHoles([]);
    setTotalScore(null);
    setTotalVsPar(null);
    Alert.alert('Round Complete', 'Your round has been saved!');
  }

  if (!roundId) {
    return (
      <View style={s.container}>
        <View style={s.startCard}>
          <Text style={s.title}>Start a New Round</Text>
          <TextInput style={s.input} placeholder="Course name" placeholderTextColor="#8BA89A" value={courseName} onChangeText={setCourseName} />
          <TouchableOpacity style={s.btn} onPress={handleStartRound} disabled={busy}>
            <Text style={s.btnText}>{busy ? 'Starting...' : 'Start Round'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
      <View style={s.header}>
        <Text style={s.headerTitle}>{courseName}</Text>
        {totalScore !== null && (
          <Text style={s.headerScore}>
            Total: {totalScore}
            {totalVsPar != null && ` (${formatVsPar(totalVsPar)})`}
          </Text>
        )}
      </View>

      {holes.length > 0 && (
        <View style={s.scorecard}>
          <View style={s.scRow}>
            <Text style={[s.scCell, s.scHeader]}>Hole</Text>
            <Text style={[s.scCell, s.scHeader]}>Par</Text>
            <Text style={[s.scCell, s.scHeader]}>Score</Text>
            <Text style={[s.scCell, s.scHeader]}>+/-</Text>
            <Text style={[s.scCell, s.scHeader]}>FW</Text>
            <Text style={[s.scCell, s.scHeader]}>GIR</Text>
          </View>
          {holes.map((h) => (
            <View key={h.hole_number} style={s.scRow}>
              <Text style={s.scCell}>{h.hole_number}</Text>
              <Text style={s.scCell}>{h.par ?? '-'}</Text>
              <Text style={s.scCell}>{h.strokes}</Text>
              <Text style={[s.scCell, h.score_vs_par != null && h.score_vs_par > 0 && s.scCellOver]}>{formatVsPar(h.score_vs_par)}</Text>
              <Text style={s.scCell}>{h.fairway_hit ? '✓' : '-'}</Text>
              <Text style={s.scCell}>{h.gir ? '✓' : '-'}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.cardTitle}>Hole {holes.length + 1}</Text>
        <Text style={s.parLabel}>Par</Text>
        <View style={s.parRow}>
          {[3, 4, 5].map((p) => (
            <TouchableOpacity
              key={p}
              style={[s.parBtn, par === p && s.parBtnActive]}
              onPress={() => setPar(p)}
            >
              <Text style={[s.parBtnText, par === p && s.parBtnTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={s.input} placeholder="Strokes *" placeholderTextColor="#8BA89A" keyboardType="numeric" value={strokes} onChangeText={setStrokes} />

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Fairway Hit</Text>
          <Switch value={fairway} onValueChange={setFairway} trackColor={{ true: '#52B788' }} />
        </View>
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Green in Regulation</Text>
          <Switch value={gir} onValueChange={setGir} trackColor={{ true: '#52B788' }} />
        </View>

        <TextInput style={[s.input, { height: 60 }]} placeholder="Notes (optional)" placeholderTextColor="#8BA89A" multiline value={notes} onChangeText={setNotes} />

        <TouchableOpacity style={s.btn} onPress={handleAddHole} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'Saving...' : 'Save Hole'}</Text>
        </TouchableOpacity>
      </View>

      {holes.length > 0 && (
        <TouchableOpacity style={s.endBtn} onPress={endRound}>
          <Text style={s.endBtnText}>Finish Round</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F7F4', justifyContent: 'center', padding: 16 },
  scroll: { flex: 1, backgroundColor: '#F0F7F4' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  startCard: { backgroundColor: '#fff', borderRadius: 14, padding: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  title: { fontSize: 22, fontWeight: '700', color: '#1B4332', marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1B4332' },
  headerScore: { fontSize: 18, fontWeight: '700', color: '#2D6A4F' },
  scorecard: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  scRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F7F4' },
  scCell: { flex: 1, textAlign: 'center', paddingVertical: 10, fontSize: 13, color: '#1B4332' },
  scCellOver: { color: '#E63946', fontWeight: '700' },
  scHeader: { fontWeight: '700', backgroundColor: '#2D6A4F', color: '#fff' },
  parLabel: { fontSize: 14, fontWeight: '600', color: '#1B4332', marginBottom: 8 },
  parRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  parBtn: { flex: 1, backgroundColor: '#F0F7F4', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  parBtnActive: { backgroundColor: '#2D6A4F' },
  parBtnText: { fontSize: 16, fontWeight: '700', color: '#6B7280' },
  parBtnTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1B4332', marginBottom: 14 },
  input: { backgroundColor: '#F0F7F4', borderRadius: 10, padding: 14, fontSize: 15, color: '#1B4332', marginBottom: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  switchLabel: { fontSize: 15, color: '#1B4332' },
  btn: { backgroundColor: '#2D6A4F', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  endBtn: { backgroundColor: '#E63946', borderRadius: 10, padding: 15, alignItems: 'center' },
  endBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
