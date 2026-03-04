import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  TextInput, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as api from '../../src/api';
import { useAuth } from '../../src/AuthContext';
import { useSubscription } from '../../src/SubscriptionContext';
import { PaywallScreen } from '../../src/PaywallScreen';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const router = useRouter();
  const { refreshSubscription } = useSubscription();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passwordModal, setPasswordModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [paywallModal, setPaywallModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  async function loadProfile() {
    setLoading(true);
    try {
      const data = await api.getProfile();
      setProfile(data);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Fill in all fields');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    setChanging(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      Alert.alert('Success', 'Password updated');
      setPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setChanging(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, all rounds, and club data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => setDeleteModal(true) },
      ],
    );
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      Alert.alert('Error', 'Please enter your password to confirm');
      return;
    }
    setDeleting(true);
    try {
      await api.deleteAccount(deletePassword);
      setDeleteModal(false);
      await signOut();
      router.replace('/login');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#2D6A4F" />
      </View>
    );
  }

  const subscriptionActive = profile?.subscription_active ?? false;
  const expiresAt = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.card}>
        <Text style={s.cardTitle}>Account</Text>
        <View style={s.row}>
          <Ionicons name="person-outline" size={20} color="#2D6A4F" />
          <Text style={s.label}>Name</Text>
        </View>
        <Text style={s.value}>{[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || '-'}</Text>
        <View style={[s.row, { marginTop: 12 }]}>
          <Ionicons name="mail-outline" size={20} color="#2D6A4F" />
          <Text style={s.label}>Email</Text>
        </View>
        <Text style={s.value}>{profile?.email ?? '-'}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Subscription</Text>
        {subscriptionActive ? (
          <>
            <View style={s.badge}>
              <Ionicons name="checkmark-circle" size={20} color="#2D6A4F" />
              <Text style={s.badgeText}>Active</Text>
            </View>
            <Text style={s.subText}>Renews or expires: {expiresAt}</Text>
            <Text style={s.hint}>Manage or cancel in your device Settings → Subscriptions.</Text>
          </>
        ) : (
          <>
            <View style={s.badgeInactive}>
              <Ionicons name="close-circle-outline" size={20} color="#6B7280" />
              <Text style={s.badgeTextInactive}>No active subscription</Text>
            </View>
            <Text style={s.hint}>Subscribe to use AI recommendations and save club distances.</Text>
            <TouchableOpacity style={s.subscribeBtn} onPress={() => setPaywallModal(true)}>
              <Ionicons name="card-outline" size={20} color="#fff" />
              <Text style={s.btnText}>Subscribe or restore</Text>
            </TouchableOpacity>
          </>
        )}
        {subscriptionActive && (
          <TouchableOpacity style={s.restoreLink} onPress={() => setPaywallModal(true)}>
            <Text style={s.restoreLinkText}>Restore purchases</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Password</Text>
        <TouchableOpacity style={s.btn} onPress={() => setPasswordModal(true)}>
          <Ionicons name="key-outline" size={20} color="#fff" />
          <Text style={s.btnText}>Change password</Text>
        </TouchableOpacity>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Account</Text>
        <Text style={s.hint}>Permanently delete your account and all associated data.</Text>
        <TouchableOpacity style={s.deleteBtn} onPress={confirmDeleteAccount}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={s.btnText}>Delete Account</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={deleteModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Confirm Account Deletion</Text>
            <Text style={s.deleteWarning}>Enter your password to permanently delete your account. This cannot be undone.</Text>
            <TextInput
              style={s.input}
              placeholder="Your password"
              placeholderTextColor="#8BA89A"
              secureTextEntry
              value={deletePassword}
              onChangeText={setDeletePassword}
            />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setDeleteModal(false); setDeletePassword(''); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.deleteConfirmBtn} onPress={handleDeleteAccount} disabled={deleting}>
                <Text style={s.btnText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={paywallModal} animationType="slide">
        <View style={s.paywallModalWrap}>
          <TouchableOpacity style={s.closePaywallBtn} onPress={() => setPaywallModal(false)}>
            <Text style={s.closePaywallText}>Close</Text>
          </TouchableOpacity>
          <PaywallScreen
            onSubscribed={() => {
              setPaywallModal(false);
              refreshSubscription();
              loadProfile();
            }}
          />
        </View>
      </Modal>

      <Modal visible={passwordModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Change password</Text>
            <TextInput
              style={s.input}
              placeholder="Current password"
              placeholderTextColor="#8BA89A"
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              style={s.input}
              placeholder="New password"
              placeholderTextColor="#8BA89A"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TextInput
              style={s.input}
              placeholder="Confirm new password"
              placeholderTextColor="#8BA89A"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <View style={s.modalRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setPasswordModal(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.submitBtn} onPress={handleChangePassword} disabled={changing}>
                <Text style={s.btnText}>{changing ? 'Updating...' : 'Update'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#F0F7F4', justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#F0F7F4' },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1B4332', marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  label: { fontSize: 14, color: '#6B7280', fontWeight: '600' },
  value: { fontSize: 16, color: '#1B4332', fontWeight: '500' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F0F7F4', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignSelf: 'flex-start', marginBottom: 8 },
  badgeText: { fontSize: 15, fontWeight: '700', color: '#2D6A4F' },
  badgeInactive: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F3F4F6', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignSelf: 'flex-start', marginBottom: 8 },
  badgeTextInactive: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  subText: { fontSize: 14, color: '#374151', marginBottom: 8 },
  hint: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2D6A4F', borderRadius: 10, padding: 14 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  subscribeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2D6A4F', borderRadius: 10, padding: 14, marginTop: 12 },
  restoreLink: { marginTop: 10 },
  restoreLinkText: { fontSize: 14, color: '#2D6A4F', fontWeight: '600' },
  paywallModalWrap: { flex: 1, backgroundColor: '#F0F7F4' },
  closePaywallBtn: { padding: 16, paddingTop: 48, alignSelf: 'flex-end' },
  closePaywallText: { fontSize: 16, color: '#2D6A4F', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1B4332', marginBottom: 16 },
  input: { backgroundColor: '#F0F7F4', borderRadius: 10, padding: 14, fontSize: 15, color: '#1B4332', marginBottom: 12 },
  modalRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  submitBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#2D6A4F', alignItems: 'center' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#DC2626', borderRadius: 10, padding: 14, marginTop: 12 },
  deleteWarning: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 16 },
  deleteConfirmBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#DC2626', alignItems: 'center' },
});
