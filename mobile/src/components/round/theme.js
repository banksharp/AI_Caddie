import { StyleSheet } from 'react-native';

// Shared look for the Round tab (matches the rest of the app).
export const colors = {
  bg: '#F0F7F4',
  card: '#fff',
  primary: '#2D6A4F',
  primarySoft: '#52B788',
  text: '#1B4332',
  muted: '#6B7280',
  placeholder: '#8BA89A',
  danger: '#E63946',
  warn: '#E9A23B',
  border: '#E5EDE9',
};

export const ui = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  btn: { backgroundColor: colors.primary, borderRadius: 10, padding: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
  },
  btnSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  chipRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 16, fontWeight: '700', color: colors.muted },
  chipTextActive: { color: '#fff' },
});

export function formatVsPar(v) {
  if (v == null) return '-';
  if (v === 0) return 'E';
  if (v > 0) return `+${v}`;
  return String(v);
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
