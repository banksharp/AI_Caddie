import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import * as api from '../../src/api';

export default function CaddieScreen() {
  const [mode, setMode] = useState('club');

  // Club recommendation state
  const [distance, setDistance] = useState('');
  const [lie, setLie] = useState('');
  const [wind, setWind] = useState('');

  // Course strategy state
  const [par, setPar] = useState('');
  const [length, setLength] = useState('');
  const [hazards, setHazards] = useState('');
  const [shape, setShape] = useState('');

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  function clearResult() {
    setResult(null);
  }

  async function getRecommendation() {
    if (!distance || !lie || !wind) return Alert.alert('Error', 'Please fill in all fields');
    setLoading(true);
    clearResult();
    try {
      const data = await api.getClubRecommendation(distance, lie, wind);
      setResult(data);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function getStrategy() {
    if (!par || !length || !hazards || !shape) return Alert.alert('Error', 'Please fill in all fields');
    setLoading(true);
    clearResult();
    try {
      const data = await api.getCourseStrategy(par, length, hazards, shape);
      setResult(data);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  const hasData = result && result.data;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.toggle}>
        <TouchableOpacity
          style={[s.toggleBtn, mode === 'club' && s.toggleActive]}
          onPress={() => { setMode('club'); clearResult(); }}
        >
          <Text style={[s.toggleText, mode === 'club' && s.toggleTextActive]}>Club Rec</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleBtn, mode === 'strategy' && s.toggleActive]}
          onPress={() => { setMode('strategy'); clearResult(); }}
        >
          <Text style={[s.toggleText, mode === 'strategy' && s.toggleTextActive]}>Strategy</Text>
        </TouchableOpacity>
      </View>

      {mode === 'club' ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Club Recommendation</Text>
          <TextInput style={s.input} placeholder="Distance to hole (yards)" placeholderTextColor="#8BA89A" keyboardType="numeric" value={distance} onChangeText={setDistance} />
          <TextInput style={s.input} placeholder="Lie (fairway, rough, sand...)" placeholderTextColor="#8BA89A" value={lie} onChangeText={setLie} />
          <TextInput style={s.input} placeholder="Wind (calm, headwind, tailwind...)" placeholderTextColor="#8BA89A" value={wind} onChangeText={setWind} />
          <TouchableOpacity style={s.btn} onPress={getRecommendation} disabled={loading}>
            <Text style={s.btnText}>{loading ? 'Thinking...' : 'Get Recommendation'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>Course Strategy</Text>
          <TextInput style={s.input} placeholder="Par (3, 4, or 5)" placeholderTextColor="#8BA89A" keyboardType="numeric" value={par} onChangeText={setPar} />
          <TextInput style={s.input} placeholder="Hole length (yards)" placeholderTextColor="#8BA89A" keyboardType="numeric" value={length} onChangeText={setLength} />
          <TextInput style={s.input} placeholder="Hazards (water, bunkers, OB...)" placeholderTextColor="#8BA89A" value={hazards} onChangeText={setHazards} />
          <TextInput style={s.input} placeholder="Hole shape (straight, dogleg left...)" placeholderTextColor="#8BA89A" value={shape} onChangeText={setShape} />
          <TouchableOpacity style={s.btn} onPress={getStrategy} disabled={loading}>
            <Text style={s.btnText}>{loading ? 'Analyzing...' : 'Get Strategy'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && <ActivityIndicator size="large" color="#2D6A4F" style={{ marginTop: 20 }} />}

      {!!result && (
        <View style={s.resultCard}>
          <Text style={s.resultTitle}>AI Caddie Says:</Text>
          {hasData ? (
            mode === 'club' ? (
              <View style={{ gap: 14 }}>
                <View style={s.pillRow}>
                  <Text style={s.pillLabel}>Recommended</Text>
                  <Text style={s.pillValue}>{result.data.recommendedClub}</Text>
                </View>

                <View>
                  <Text style={s.sectionTitle}>Why</Text>
                  {(result.data.why || []).map((t, idx) => (
                    <Text key={idx} style={s.bullet}>• {t}</Text>
                  ))}
                </View>

                <View>
                  <Text style={s.sectionTitle}>Tips</Text>
                  {(result.data.tips || []).map((t, idx) => (
                    <Text key={idx} style={s.bullet}>• {t}</Text>
                  ))}
                </View>
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                {result.data.teeShot && (
                  <View>
                    <Text style={s.sectionTitle}>Tee shot</Text>
                    <Text style={s.kv}>Club: <Text style={s.kvStrong}>{result.data.teeShot.club || '-'}</Text></Text>
                    <Text style={s.kv}>Aim: <Text style={s.kvStrong}>{result.data.teeShot.aim || '-'}</Text></Text>
                    {!!result.data.teeShot.shape && (
                      <Text style={s.kv}>Shape: <Text style={s.kvStrong}>{result.data.teeShot.shape}</Text></Text>
                    )}
                    {!!result.data.teeShot.notes && <Text style={s.note}>{result.data.teeShot.notes}</Text>}
                  </View>
                )}

                {result.data.secondShot && result.data.secondShot.club && (
                  <View>
                    <Text style={s.sectionTitle}>{result.data.secondShot.situation || 'Second shot'}</Text>
                    <Text style={s.kv}>Club: <Text style={s.kvStrong}>{result.data.secondShot.club}</Text></Text>
                    {!!result.data.secondShot.aim && <Text style={s.kv}>Aim: <Text style={s.kvStrong}>{result.data.secondShot.aim}</Text></Text>}
                    {!!result.data.secondShot.notes && <Text style={s.note}>{result.data.secondShot.notes}</Text>}
                  </View>
                )}

                {(result.data.otherShots || []).filter((s) => s && (s.club || s.notes)).map((shot, idx) => (
                  <View key={idx}>
                    <Text style={s.sectionTitle}>{shot.situation || `Shot ${idx + 3}`}</Text>
                    {!!shot.club && <Text style={s.kv}>Club: <Text style={s.kvStrong}>{shot.club}</Text></Text>}
                    {!!shot.aim && <Text style={s.kv}>Aim: <Text style={s.kvStrong}>{shot.aim}</Text></Text>}
                    {!!shot.notes && <Text style={s.note}>{shot.notes}</Text>}
                  </View>
                ))}

                {result.data.approach && (
                  <View>
                    <Text style={s.sectionTitle}>Approach to green</Text>
                    <Text style={s.kv}>Club: <Text style={s.kvStrong}>{result.data.approach.club || '-'}</Text></Text>
                    <Text style={s.kv}>Aim: <Text style={s.kvStrong}>{result.data.approach.aim || '-'}</Text></Text>
                    {!!result.data.approach.notes && <Text style={s.note}>{result.data.approach.notes}</Text>}
                  </View>
                )}

                {!!(result.data.avoid || []).length && (
                  <View>
                    <Text style={s.sectionTitle}>Avoid</Text>
                    {(result.data.avoid || []).map((t, idx) => (
                      <Text key={idx} style={s.bullet}>• {t}</Text>
                    ))}
                  </View>
                )}

                {!!(result.data.notes || []).length && (
                  <View>
                    <Text style={s.sectionTitle}>Notes</Text>
                    {(result.data.notes || []).map((t, idx) => (
                      <Text key={idx} style={s.bullet}>• {t}</Text>
                    ))}
                  </View>
                )}
              </View>
            )
          ) : (
            <Text style={s.resultText}>{result.advice}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F7F4' },
  content: { padding: 16, paddingBottom: 40 },
  toggle: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  toggleActive: { backgroundColor: '#2D6A4F' },
  toggleText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  toggleTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1B4332', marginBottom: 16 },
  input: { backgroundColor: '#F0F7F4', borderRadius: 10, padding: 14, fontSize: 15, color: '#1B4332', marginBottom: 12 },
  btn: { backgroundColor: '#2D6A4F', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  resultCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20, marginTop: 8, borderLeftWidth: 4, borderLeftColor: '#52B788' },
  resultTitle: { fontSize: 16, fontWeight: '700', color: '#2D6A4F', marginBottom: 10 },
  resultText: { fontSize: 15, color: '#374151', lineHeight: 22 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#1B4332', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  bullet: { fontSize: 15, color: '#374151', lineHeight: 22, marginBottom: 6 },
  pillRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F0F7F4', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  pillLabel: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.6 },
  pillValue: { fontSize: 18, fontWeight: '900', color: '#2D6A4F' },
  kv: { fontSize: 15, color: '#374151', lineHeight: 22, marginBottom: 4 },
  kvStrong: { fontWeight: '800', color: '#1B4332' },
  note: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginTop: 6 },
});
