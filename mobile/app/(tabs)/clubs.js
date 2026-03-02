import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert,
} from 'react-native';
import * as api from '../../src/api';

const CLUB_LIST = [
  'Driver', '3-Wood', '5-Wood', '3-Hybrid', '4-Hybrid',
  '4-Iron', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron',
  'Pitching Wedge', 'Gap Wedge', 'Sand Wedge', 'Lob Wedge',
];

export default function ClubsScreen() {
  const [clubs, setClubs] = useState({});
  const [saving, setSaving] = useState(false);

  function updateClub(name, value) {
    if (value === '') {
      const next = { ...clubs };
      delete next[name];
      setClubs(next);
    } else {
      setClubs({ ...clubs, [name]: parseInt(value) || 0 });
    }
  }

  async function save() {
    const filled = Object.keys(clubs).length;
    if (filled === 0) return Alert.alert('Error', 'Please enter at least one club distance');
    setSaving(true);
    try {
      await api.setupClubs(clubs);
      Alert.alert('Saved', `${filled} club distance${filled > 1 ? 's' : ''} saved!`);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.card}>
        <Text style={s.title}>Club Distances</Text>
        <Text style={s.subtitle}>Enter your average distance in yards for each club. Skip any you don't carry.</Text>

        {CLUB_LIST.map((name) => (
          <View key={name} style={s.row}>
            <Text style={s.clubName}>{name}</Text>
            <TextInput
              style={s.distInput}
              placeholder="yards"
              placeholderTextColor="#8BA89A"
              keyboardType="numeric"
              value={clubs[name] !== undefined ? String(clubs[name]) : ''}
              onChangeText={(v) => updateClub(name, v)}
            />
          </View>
        ))}

        <TouchableOpacity style={s.btn} onPress={save} disabled={saving}>
          <Text style={s.btnText}>{saving ? 'Saving...' : 'Save Clubs'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F7F4' },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  title: { fontSize: 20, fontWeight: '700', color: '#1B4332', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#6B7280', marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F7F4' },
  clubName: { fontSize: 15, color: '#1B4332', fontWeight: '500', flex: 1 },
  distInput: { backgroundColor: '#F0F7F4', borderRadius: 8, padding: 10, width: 90, textAlign: 'center', fontSize: 15, color: '#1B4332' },
  btn: { backgroundColor: '#2D6A4F', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
