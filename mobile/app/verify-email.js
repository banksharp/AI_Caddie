import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../src/supabase';
import { useAuth } from '../src/AuthContext';

const logo = require('../assets/icon.png');

export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams();
  const { signOut } = useAuth();
  const router = useRouter();
  const [resending, setResending] = useState(false);

  async function handleResend() {
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      Alert.alert('Email Sent', 'A new verification email has been sent.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not resend email.');
    } finally {
      setResending(false);
    }
  }

  async function handleBackToLogin() {
    await signOut();
    router.replace('/login');
  }

  return (
    <View style={s.container}>
      <View style={s.card}>
        <Image source={logo} style={s.logoImage} />
        <View style={s.iconWrap}>
          <Ionicons name="mail-outline" size={56} color="#2D6A4F" />
        </View>
        <Text style={s.title}>Verify Your Email</Text>
        <Text style={s.message}>
          We've sent a verification link to
        </Text>
        <Text style={s.email}>{email || 'your email'}</Text>
        <Text style={s.message}>
          Please check your inbox and tap the link to activate your account.
        </Text>

        <TouchableOpacity style={s.resendBtn} onPress={handleResend} disabled={resending}>
          <Ionicons name="refresh-outline" size={18} color="#2D6A4F" />
          <Text style={s.resendText}>{resending ? 'Sending...' : 'Resend verification email'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.backBtn} onPress={handleBackToLogin}>
          <Text style={s.backText}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2D6A4F', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 28,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 6,
    alignItems: 'center',
  },
  logoImage: { width: 80, height: 80, borderRadius: 16, marginBottom: 16 },
  iconWrap: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#1B4332', marginBottom: 12 },
  message: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
  email: { fontSize: 16, fontWeight: '700', color: '#2D6A4F', marginVertical: 8 },
  resendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 24, padding: 14, backgroundColor: '#F0F7F4',
    borderRadius: 10, width: '100%', justifyContent: 'center',
  },
  resendText: { fontSize: 15, fontWeight: '600', color: '#2D6A4F' },
  backBtn: { marginTop: 16, padding: 12 },
  backText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
});
