import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../src/api';
import { useSubscription } from '../../src/SubscriptionContext';
import { PaywallScreen } from '../../src/PaywallScreen';

const CLUB_LIST = [
  'Driver', '3-Wood', '5-Wood', '3-Hybrid', '4-Hybrid',
  '4-Iron', '5-Iron', '6-Iron', '7-Iron', '8-Iron', '9-Iron',
  'Pitching Wedge', 'Gap Wedge', 'Sand Wedge', 'Lob Wedge',
];

export default function ClubsScreen() {
  const { subscriptionActive, loading: subLoading } = useSubscription();
  const [savedClubs, setSavedClubs] = useState({});
  const [editClubs, setEditClubs] = useState({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadClubs();
  }, []);

  async function loadClubs() {
    try {
      const data = await api.getProfile();
      if (data.clubs && Object.keys(data.clubs).length > 0) {
        setSavedClubs(data.clubs);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  function startEditing() {
    setEditClubs({ ...savedClubs });
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditClubs({});
  }

  function updateClub(name, value) {
    if (value === '') {
      const next = { ...editClubs };
      delete next[name];
      setEditClubs(next);
    } else {
      setEditClubs({ ...editClubs, [name]: parseInt(value) || 0 });
    }
  }

  async function saveChanges() {
    const filled = Object.keys(editClubs).length;
    if (filled === 0) return Alert.alert('Error', 'Please enter at least one club distance');
    setSaving(true);
    try {
      await api.setupClubs(editClubs);
      setSavedClubs({ ...editClubs });
      setEditing(false);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  }

  const hasSavedClubs = Object.keys(savedClubs).length > 0;
  const sortedClubs = CLUB_LIST.filter((c) => savedClubs[c] !== undefined);

  if (subLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#2D6A4F" />
      </View>
    );
  }
  if (!subscriptionActive) {
    return (
      <PaywallScreen
        title="Unlock My Clubs"
        subtitle="Subscribe to save and edit your club distances for better AI recommendations."
      />
    );
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#2D6A4F" />
      </View>
    );
  }

  if (editing) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <View style={s.card}>
          <View style={s.editHeader}>
            <Text style={s.title}>{hasSavedClubs ? 'Edit Clubs' : 'Add Clubs'}</Text>
            <TouchableOpacity onPress={cancelEditing}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.subtitle}>Enter your average distance in yards. Skip any you don't carry.</Text>

          {CLUB_LIST.map((name) => (
            <View key={name} style={s.row}>
              <Text style={s.clubName}>{name}</Text>
              <TextInput
                style={s.distInput}
                placeholder="yards"
                placeholderTextColor="#8BA89A"
                keyboardType="numeric"
                value={editClubs[name] !== undefined ? String(editClubs[name]) : ''}
                onChangeText={(v) => updateClub(name, v)}
              />
            </View>
          ))}

          <TouchableOpacity style={s.btn} onPress={saveChanges} disabled={saving}>
            <Text style={s.btnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.card}>
        <View style={s.viewHeader}>
          <Text style={s.title}>My Clubs</Text>
          <TouchableOpacity style={s.editBtn} onPress={startEditing}>
            <Ionicons name={hasSavedClubs ? 'create-outline' : 'add-circle-outline'} size={18} color="#2D6A4F" />
            <Text style={s.editBtnText}>{hasSavedClubs ? 'Edit' : 'Add New'}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.clubBox}>
          {hasSavedClubs ? (
            sortedClubs.map((name) => (
              <View key={name} style={s.savedRow}>
                <Text style={s.savedClubName}>{name}</Text>
                <Text style={s.savedClubDist}>{savedClubs[name]} yds</Text>
              </View>
            ))
          ) : (
            <View style={s.emptyBox}>
              <Ionicons name="golf-outline" size={32} color="#9CA3AF" />
              <Text style={s.emptyText}>No clubs saved</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#F0F7F4', justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#F0F7F4' },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },

  viewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '700', color: '#1B4332' },
  subtitle: { fontSize: 13, color: '#6B7280', marginBottom: 20 },

  editBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F7F4', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  editBtnText: { fontSize: 14, fontWeight: '600', color: '#2D6A4F' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#E63946' },

  clubBox: { backgroundColor: '#F0F7F4', borderRadius: 12, padding: 16, minHeight: 80 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 15, color: '#9CA3AF', fontWeight: '500' },

  savedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E5EDE9' },
  savedClubName: { fontSize: 15, color: '#1B4332', fontWeight: '500' },
  savedClubDist: { fontSize: 15, color: '#2D6A4F', fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F7F4' },
  clubName: { fontSize: 15, color: '#1B4332', fontWeight: '500', flex: 1 },
  distInput: { backgroundColor: '#F0F7F4', borderRadius: 8, padding: 10, width: 90, textAlign: 'center', fontSize: 15, color: '#1B4332' },

  btn: { backgroundColor: '#2D6A4F', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
