import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function PaywallScreen({ onSubscribed, title, subtitle }) {
  return (
    <View style={s.container}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <Ionicons name="golf" size={48} color="#2D6A4F" />
        </View>
        <Text style={s.title}>{title ?? 'Unlock AI Caddie Pro'}</Text>
        <Text style={s.subtitle}>
          {subtitle ?? 'Get club recommendations and course strategy on every hole. Subscribe to unlock.'}
        </Text>

        <View style={s.features}>
          <FeatureRow text="Club recommendation by distance, lie & wind" />
          <FeatureRow text="Hole-by-hole course strategy" />
          <FeatureRow text="Save and edit your club distances" />
        </View>

        <View style={s.comingSoon}>
          <Ionicons name="time-outline" size={20} color="#2D6A4F" />
          <Text style={s.comingSoonText}>Subscription coming soon</Text>
        </View>
      </View>
    </View>
  );
}

function FeatureRow({ text }) {
  return (
    <View style={s.featureRow}>
      <Ionicons name="checkmark-circle" size={20} color="#2D6A4F" />
      <Text style={s.featureText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F7F4',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  iconWrap: {
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1B4332',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  features: {
    marginBottom: 24,
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
  comingSoon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F0F7F4',
    borderRadius: 12,
    padding: 16,
  },
  comingSoonText: {
    color: '#2D6A4F',
    fontSize: 16,
    fontWeight: '700',
  },
});
