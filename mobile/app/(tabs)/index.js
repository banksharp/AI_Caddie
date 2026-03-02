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

  const [advice, setAdvice] = useState('');
  const [loading, setLoading] = useState(false);

  async function getRecommendation() {
    if (!distance || !lie || !wind) return Alert.alert('Error', 'Please fill in all fields');
    setLoading(true);
    setAdvice('');
    try {
      const data = await api.getClubRecommendation(distance, lie, wind);
      setAdvice(data.advice);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function getStrategy() {
    if (!par || !length || !hazards || !shape) return Alert.alert('Error', 'Please fill in all fields');
    setLoading(true);
    setAdvice('');
    try {
      const data = await api.getCourseStrategy(par, length, hazards, shape);
      setAdvice(data.advice);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.toggle}>
        <TouchableOpacity
          style={[s.toggleBtn, mode === 'club' && s.toggleActive]}
          onPress={() => { setMode('club'); setAdvice(''); }}
        >
          <Text style={[s.toggleText, mode === 'club' && s.toggleTextActive]}>Club Rec</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleBtn, mode === 'strategy' && s.toggleActive]}
          onPress={() => { setMode('strategy'); setAdvice(''); }}
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

      {advice !== '' && (
        <View style={s.resultCard}>
          <Text style={s.resultTitle}>AI Caddie Says:</Text>
          <Text style={s.resultText}>{advice}</Text>
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
});
