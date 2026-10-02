import { memo, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, ordinal } from './theme';

/**
 * Hole header: prev/next, "Hole N · Par P · L yds", a strip of hole numbers with scored
 * checkmarks, and a dismissible GPS hole suggestion.
 */
function HoleNavigator({
  holeNumber,
  par,
  lengthYds,
  holeNumbers,
  scored,
  onSelectHole,
  onPrev,
  onNext,
  suggestion,
  onAcceptSuggestion,
  onDismissSuggestion,
}) {
  const stripRef = useRef(null);
  const index = holeNumbers.indexOf(holeNumber);

  useEffect(() => {
    if (index >= 0) stripRef.current?.scrollTo({ x: Math.max(0, index * 38 - 120), animated: true });
  }, [index]);

  const parts = [`Hole ${holeNumber}`];
  if (par != null) parts.push(`Par ${par}`);
  if (lengthYds != null) parts.push(`${lengthYds} yds`);

  return (
    <View style={s.card}>
      {suggestion && (
        <View style={s.banner}>
          <Ionicons name="navigate" size={16} color={colors.primary} />
          <Text style={s.bannerText}>
            {suggestion.reason === 'on_hole_line'
              ? `Playing the ${ordinal(suggestion.holeNumber)}?`
              : `On the ${ordinal(suggestion.holeNumber)} tee?`}
          </Text>
          <TouchableOpacity onPress={onAcceptSuggestion} style={s.bannerBtn}>
            <Text style={s.bannerBtnText}>Switch</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismissSuggestion} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
      )}

      <View style={s.row}>
        <TouchableOpacity onPress={onPrev} disabled={!onPrev} style={s.arrow} accessibilityLabel="Previous hole">
          <Ionicons name="chevron-back" size={24} color={onPrev ? colors.primary : '#C9D6CF'} />
        </TouchableOpacity>
        <View style={s.titleWrap}>
          <Text style={s.title}>{parts.join(' · ')}</Text>
          {scored.has(holeNumber) && <Ionicons name="checkmark-circle" size={18} color={colors.primarySoft} />}
        </View>
        <TouchableOpacity onPress={onNext} disabled={!onNext} style={s.arrow} accessibilityLabel="Next hole">
          <Ionicons name="chevron-forward" size={24} color={onNext ? colors.primary : '#C9D6CF'} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {holeNumbers.map((n) => {
          const done = scored.has(n);
          const current = n === holeNumber;
          return (
            <TouchableOpacity
              key={n}
              onPress={() => onSelectHole(n)}
              style={[s.dot, done && s.dotDone, current && s.dotCurrent]}
            >
              <Text style={[s.dotText, done && s.dotTextDone, current && !done && s.dotTextCurrent]}>{n}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default memo(HoleNavigator);

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E3F2EA', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 10 },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  bannerBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  bannerBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center' },
  arrow: { padding: 6 },
  titleWrap: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  strip: { paddingTop: 10, gap: 6 },
  dot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  dotDone: { backgroundColor: colors.primarySoft },
  dotCurrent: { borderColor: colors.primary },
  dotText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  dotTextDone: { color: '#fff' },
  dotTextCurrent: { color: colors.primary },
});
