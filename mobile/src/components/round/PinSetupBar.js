import { memo, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, ui } from './theme';

const PARS = [3, 4, 5];

/**
 * Setting a green by hand. Shown in pin mode (always when the hole has no green); the map
 * reports the tapped point as `pendingCenter`. Outside pin mode it offers "Edit green".
 * onSave({ par }) saves the pin for the current hole.
 */
function PinSetupBar({ holeNumber, hasGreen, pinMode, pendingCenter, defaultPar, onStartEdit, onCancel, onSave }) {
  const [par, setPar] = useState(defaultPar ?? 4);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPar(defaultPar ?? 4);
  }, [holeNumber, defaultPar]);

  if (!pinMode) {
    return (
      <TouchableOpacity style={s.editLink} onPress={onStartEdit}>
        <Ionicons name="flag-outline" size={16} color={colors.primary} />
        <Text style={s.editLinkText}>{hasGreen ? 'Edit' : 'Set'} green for hole {holeNumber}</Text>
      </TouchableOpacity>
    );
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({ par });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={ui.card}>
      <Text style={s.title}>
        {pendingCenter ? 'Green set. Adjust by tapping again.' : `Tap the middle of the green for hole ${holeNumber}`}
      </Text>
      <Text style={s.hint}>Saved privately to your account and used every time you play here.</Text>
      <Text style={s.label}>Par</Text>
      <View style={[ui.chipRow, s.gap]}>
        {PARS.map((p) => (
          <TouchableOpacity key={p} style={[ui.chip, par === p && ui.chipActive]} onPress={() => setPar(p)}>
            <Text style={[ui.chipText, par === p && ui.chipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={s.buttons}>
        {(hasGreen || onCancel) && (
          <TouchableOpacity style={[ui.btnSecondary, s.flex]} onPress={onCancel} disabled={saving}>
            <Text style={ui.btnSecondaryText}>{hasGreen ? 'Cancel' : 'Later'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[ui.btn, s.flex, !pendingCenter && s.disabled]}
          onPress={save}
          disabled={!pendingCenter || saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={ui.btnText}>Save green</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default memo(PinSetupBar);

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  gap: { marginBottom: 12 },
  buttons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  disabled: { opacity: 0.5 },
  editLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, marginBottom: 8 },
  editLinkText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
