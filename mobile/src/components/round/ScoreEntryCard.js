import { memo, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import { colors, ui } from './theme';

const PARS = [3, 4, 5];

/**
 * Score entry for one hole. `existing` is the saved scorecard row when editing.
 * onSave(holeData) should resolve when saved (or queued) and throw on failure.
 */
function ScoreEntryCard({ holeNumber, defaultPar, existing, onSave }) {
  const initialPar = existing?.par ?? defaultPar ?? 4;
  const [par, setPar] = useState(initialPar);
  const [strokes, setStrokes] = useState(existing?.strokes != null ? String(existing.strokes) : '');
  const [fairway, setFairway] = useState(!!existing?.fairway_hit);
  const [gir, setGir] = useState(!!existing?.gir);
  const [notes, setNotes] = useState(existing?.notes || '');
  const [busy, setBusy] = useState(false);

  // New hole (or its saved row changed): reset the form.
  useEffect(() => {
    setPar(existing?.par ?? defaultPar ?? 4);
    setStrokes(existing?.strokes != null ? String(existing.strokes) : '');
    setFairway(!!existing?.fairway_hit);
    setGir(!!existing?.gir);
    setNotes(existing?.notes || '');
  }, [holeNumber, existing, defaultPar]);

  async function handleSave() {
    const strokesNum = parseInt(strokes, 10);
    if (!Number.isInteger(strokesNum) || strokesNum < 1 || String(strokesNum) !== strokes.trim()) {
      Alert.alert('Error', 'Please enter a valid number of strokes');
      return;
    }
    setBusy(true);
    try {
      await onSave({
        hole_number: holeNumber,
        par,
        strokes: strokesNum,
        fairway_hit: fairway,
        gir,
        notes: notes.trim() || null,
      });
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setBusy(false);
    }
  }

  const pars = PARS.includes(par) ? PARS : [...PARS, par].sort((a, b) => a - b);

  return (
    <View style={ui.card}>
      <Text style={ui.cardTitle}>{existing ? `Edit hole ${holeNumber}` : `Score hole ${holeNumber}`}</Text>
      <Text style={s.label}>Par</Text>
      <View style={[ui.chipRow, s.gap]}>
        {pars.map((p) => (
          <TouchableOpacity key={p} style={[ui.chip, par === p && ui.chipActive]} onPress={() => setPar(p)}>
            <Text style={[ui.chipText, par === p && ui.chipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={ui.input}
        placeholder="Strokes *"
        placeholderTextColor={colors.placeholder}
        keyboardType="number-pad"
        value={strokes}
        onChangeText={setStrokes}
      />
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Fairway Hit</Text>
        <Switch value={fairway} onValueChange={setFairway} trackColor={{ true: colors.primarySoft }} />
      </View>
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Green in Regulation</Text>
        <Switch value={gir} onValueChange={setGir} trackColor={{ true: colors.primarySoft }} />
      </View>
      <TextInput
        style={[ui.input, { height: 60 }]}
        placeholder="Notes (optional)"
        placeholderTextColor={colors.placeholder}
        multiline
        value={notes}
        onChangeText={setNotes}
      />
      <TouchableOpacity style={ui.btn} onPress={handleSave} disabled={busy}>
        <Text style={ui.btnText}>{busy ? 'Saving...' : existing ? 'Update Hole' : 'Save Hole'}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default memo(ScoreEntryCard);

const s = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  gap: { marginBottom: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  switchLabel: { fontSize: 15, color: colors.text },
});
