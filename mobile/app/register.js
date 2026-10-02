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

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const { signUp } = useAuth();
  const router = useRouter();
  const fontsLoaded = useGreenBookFonts();

  async function handleRegister() {
    if (!firstName || !lastName || !email || !password || !confirm) return Alert.alert('Error', 'Please fill in all fields');
    if (password !== confirm) return Alert.alert('Error', 'Passwords do not match');
    if (password.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters');

    setBusy(true);
    try {
      await signUp(firstName, lastName, email, password);
      router.replace({ pathname: '/verify-email', params: { email } });
    } catch (err) {
      Alert.alert('Registration Failed', err.message);
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
      <Text style={[gb.word, fontsLoaded && gb.wordFont]}>Create account</Text>
      <Text style={gb.subtitle}>Join Club Sense and improve your game</Text>

      <View style={gb.form}>
        <View style={gb.row}>
          <GreenBookInput
            style={gb.rowItem}
            placeholder="First name"
            autoCapitalize="words"
            textContentType="givenName"
            value={firstName}
            onChangeText={setFirstName}
          />
          <GreenBookInput
            style={gb.rowItem}
            placeholder="Last name"
            autoCapitalize="words"
            textContentType="familyName"
            value={lastName}
            onChangeText={setLastName}
          />
        </View>
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
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
        />
        <GreenBookInput
          placeholder="Confirm password"
          secureTextEntry
          textContentType="newPassword"
          value={confirm}
          onChangeText={setConfirm}
          onSubmitEditing={handleRegister}
        />

        <TouchableOpacity style={[gb.btn, busy && gb.btnBusy]} onPress={handleRegister} disabled={busy}>
          <Text style={gb.btnText}>{busy ? 'Creating...' : 'Create Account'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()}>
          <Text style={gb.link}>Already have an account? <Text style={gb.linkBold}>Sign in</Text></Text>
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
