import { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image,
  TouchableWithoutFeedback, Keyboard, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { GreenBookBackground, GreenBookInput, gb, useGreenBookFonts } from '../src/GreenBook';

const logo = require('../assets/icon.png');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const fontsLoaded = useGreenBookFonts();

  async function handleLogin() {
    if (!email || !password) return Alert.alert('Error', 'Please fill in all fields');
    setBusy(true);
    try {
      const data = await signIn(email, password);
      if (!data?.user?.email_confirmed_at) {
        router.replace({ pathname: '/verify-email', params: { email } });
        return;
      }
      router.replace('/(tabs)');
    } catch (err) {
      const msg = err?.message || 'Login failed';
      if (msg.toLowerCase().includes('email not confirmed')) {
        router.replace({ pathname: '/verify-email', params: { email } });
      } else {
        Alert.alert('Login Failed', msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <GreenBookBackground>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={gb.scrollContent} keyboardShouldPersistTaps="handled">
      <Image source={logo} style={gb.mark} />
      <Text style={[gb.word, fontsLoaded && gb.wordFont]}>Club Sense</Text>
      <Text style={[gb.read, fontsLoaded && gb.readFont]}>Slope 2.1% · Break left · 18 ft</Text>

      <View style={gb.form}>
        <GreenBookInput
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
        />
        <GreenBookInput
          placeholder="Password"
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity style={[gb.btn, busy && gb.btnBusy]} onPress={handleLogin} disabled={busy}>
          <Text style={gb.btnText}>{busy ? 'Signing in...' : 'Sign In'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/register')}>
          <Text style={gb.link}>No account yet? <Text style={gb.linkBold}>Create one</Text></Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
    </GreenBookBackground>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
});
