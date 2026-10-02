import { useState } from 'react';
import { ImageBackground, StyleSheet, TextInput } from 'react-native';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';

// "Green book" look for the sign-in screens: deep green with green-reading slope contours.
const background = require('../assets/green-book.png');

export const colors = {
  ground: '#102419',
  text: '#E8F3EC',
  textMuted: 'rgba(232,243,236,0.65)',
  placeholder: 'rgba(232,243,236,0.45)',
  line: 'rgba(183,228,199,0.35)',
  lineFocused: '#B7E4C7',
  mint: '#B7E4C7',
  mintSoft: '#7FB89A',
  buttonText: '#0E2A1C',
};

/** Loads the display and mono faces; screens render with system fonts until they're ready. */
export function useGreenBookFonts() {
  const [loaded] = useFonts({ BricolageGrotesque_700Bold, JetBrainsMono_500Medium });
  return loaded;
}

export function GreenBookBackground({ children }) {
  return (
    <ImageBackground source={background} resizeMode="cover" style={gb.fill} imageStyle={gb.image}>
      {children}
    </ImageBackground>
  );
}

/** Underlined text field; the line brightens while focused. */
export function GreenBookInput({ style, onFocus, onBlur, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.placeholder}
      selectionColor={colors.mint}
      {...props}
      style={[gb.input, focused && gb.inputFocused, style]}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
    />
  );
}

export const gb = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ground },
  image: { backgroundColor: colors.ground },
  // Centered column so the form doesn't stretch across an iPad screen.
  scrollContent: { flexGrow: 1, paddingHorizontal: 30, paddingTop: 96, paddingBottom: 36, width: '100%', maxWidth: 560, alignSelf: 'center' },
  mark: { width: 48, height: 48, borderRadius: 12 },
  word: { marginTop: 18, fontSize: 36, color: colors.text, fontWeight: '700', letterSpacing: -0.6 },
  wordFont: { fontFamily: 'BricolageGrotesque_700Bold', fontWeight: 'normal' },
  read: { marginTop: 10, fontSize: 11, letterSpacing: 0.7, color: colors.mintSoft, textTransform: 'uppercase' },
  readFont: { fontFamily: 'JetBrainsMono_500Medium' },
  subtitle: { marginTop: 8, fontSize: 15, color: colors.textMuted },
  form: { marginTop: 'auto', paddingTop: 40, gap: 26 },
  input: {
    fontSize: 16,
    color: colors.text,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  inputFocused: { borderBottomColor: colors.lineFocused },
  row: { flexDirection: 'row', gap: 20 },
  rowItem: { flex: 1 },
  btn: { marginTop: 4, backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 17, alignItems: 'center' },
  btnBusy: { opacity: 0.7 },
  btnText: { color: colors.buttonText, fontSize: 16, fontWeight: '700' },
  link: { textAlign: 'center', color: colors.textMuted, fontSize: 14 },
  linkBold: { color: colors.mint, fontWeight: '700' },
});
