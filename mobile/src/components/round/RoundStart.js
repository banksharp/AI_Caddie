import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CoursePicker from './CoursePicker';
import { colors, ui } from './theme';

/**
 * No round in progress: "Find a course" (GPS map + yardage) or "Just keep score".
 * onStart({ courseName, courseId?, loopKeys?, startingHole? }) starts the round.
 */
export default function RoundStart({ onStart }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scoreOnly, setScoreOnly] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [busy, setBusy] = useState(false);

  async function startScoreOnly() {
    if (!courseName.trim()) return Alert.alert('Error', 'Please enter a course name');
    setBusy(true);
    try {
      await onStart({ courseName: courseName.trim() });
      setCourseName('');
      setScoreOnly(false);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function startFromPicker(params) {
    await onStart(params);
    setPickerOpen(false);
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Start a New Round</Text>

      <TouchableOpacity style={s.option} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
        <View style={s.iconWrap}>
          <Ionicons name="map-outline" size={26} color="#fff" />
        </View>
        <View style={s.flex}>
          <Text style={s.optionTitle}>Find a course</Text>
          <Text style={s.optionText}>Satellite hole map with live GPS yardage to the green and hazards.</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.muted} />
      </TouchableOpacity>

      <TouchableOpacity style={s.option} onPress={() => setScoreOnly((v) => !v)} activeOpacity={0.8}>
        <View style={[s.iconWrap, s.iconAlt]}>
          <Ionicons name="create-outline" size={26} color={colors.primary} />
        </View>
        <View style={s.flex}>
          <Text style={s.optionTitle}>Just keep score</Text>
          <Text style={s.optionText}>Type the course name and record your scores.</Text>
        </View>
        <Ionicons name={scoreOnly ? 'chevron-down' : 'chevron-forward'} size={22} color={colors.muted} />
      </TouchableOpacity>

      {scoreOnly && (
        <View style={ui.card}>
          <TextInput
            style={ui.input}
            placeholder="Course name"
            placeholderTextColor={colors.placeholder}
            value={courseName}
            onChangeText={setCourseName}
            returnKeyType="go"
            onSubmitEditing={startScoreOnly}
          />
          <TouchableOpacity style={ui.btn} onPress={startScoreOnly} disabled={busy}>
            <Text style={ui.btnText}>{busy ? 'Starting...' : 'Start Round'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <CoursePicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onStart={startFromPicker} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingTop: 24, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 16 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 14,
    padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  iconWrap: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  iconAlt: { backgroundColor: colors.bg },
  flex: { flex: 1 },
  optionTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  optionText: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
});
