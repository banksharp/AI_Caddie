import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import * as api from '../src/api';

const logo = require('../assets/icon.png');

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function handleRegister() {
    if (!email || !password || !confirm) return Alert.alert('Error', 'Please fill in all fields');
    if (password !== confirm) return Alert.alert('Error', 'Passwords do not match');
    if (password.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters');

    setBusy(true);
    try {
      const data = await api.register(email, password);
      await signIn(data.access_token);
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Registration Failed', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.card}>
        <Image source={logo} style={s.logoImage} />
        <Text style={s.logo}>Create Account</Text>
        <Text style={s.subtitle}>Join cAIddie and improve your game</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor="#8BA89A"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor="#8BA89A"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={s.input}
          placeholder="Confirm Password"
          placeholderTextColor="#8BA89A"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />

        <TouchableOpacity style={s.btn} onPress={handleRegister} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'Creating...' : 'Create Account'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.link}>Already have an account? <Text style={s.linkBold}>Sign in</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2D6A4F', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 28, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 6 },
  logoImage: { width: 120, height: 120, alignSelf: 'center', marginBottom: 12, borderRadius: 20 },
  logo: { fontSize: 28, fontWeight: '800', color: '#2D6A4F', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 28 },
  input: { backgroundColor: '#F0F7F4', borderRadius: 10, padding: 14, fontSize: 16, color: '#1B4332', marginBottom: 14 },
  btn: { backgroundColor: '#2D6A4F', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 16 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { textAlign: 'center', color: '#6B7280', fontSize: 14 },
  linkBold: { color: '#2D6A4F', fontWeight: '700' },
});
