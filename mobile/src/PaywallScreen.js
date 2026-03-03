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
import { SUBSCRIPTION_PRODUCT_ID } from './constants';
import * as api from './api';
import { useSubscription } from './SubscriptionContext';

let iap = null;
try {
  iap = require('expo-iap');
} catch {
  iap = null;
}

async function connectAndPurchase() {
  if (!iap) throw new Error('In-app purchases not available in this build.');

  await iap.initConnection();
  await iap.fetchProducts({ skus: [SUBSCRIPTION_PRODUCT_ID], type: 'subs' });

  const result = await iap.requestPurchase({
    request: {
      apple: { sku: SUBSCRIPTION_PRODUCT_ID },
      google: { skus: [SUBSCRIPTION_PRODUCT_ID] },
    },
    type: 'subs',
  });

  const purchase = Array.isArray(result) ? result[0] : result;
  if (!purchase) throw new Error('Purchase was cancelled.');

  const transactionId = purchase.transactionId ?? purchase.purchaseToken ?? null;
  if (!transactionId) throw new Error('Could not get transaction ID.');

  try { await iap.finishTransaction({ purchase, isConsumable: false }); } catch {}
  return transactionId;
}

async function connectAndRestore() {
  if (!iap) throw new Error('In-app purchases not available in this build.');

  await iap.initConnection();
  await iap.restorePurchases();

  const purchases = await iap.getAvailablePurchases({
    alsoPublishToEventListenerIOS: false,
    onlyIncludeActiveItemsIOS: true,
  });

  const sub = Array.isArray(purchases)
    ? purchases.find((p) => p.productId === SUBSCRIPTION_PRODUCT_ID)
    : null;

  const transactionId = sub?.transactionId ?? sub?.purchaseToken ?? null;
  if (!transactionId) throw new Error('No active subscription found for this account.');

  return transactionId;
}

export function PaywallScreen({ onSubscribed, title, subtitle }) {
  const { refreshSubscription } = useSubscription();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleSubscribe = async () => {
    setPurchasing(true);
    try {
      const transactionId = await connectAndPurchase();
      await api.verifySubscription(transactionId);
      await refreshSubscription();
      onSubscribed?.();
    } catch (err) {
      const msg = err?.message || 'Purchase failed';
      if (!msg.toLowerCase().includes('cancel')) {
        Alert.alert('Purchase failed', msg);
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const transactionId = await connectAndRestore();
      await api.verifySubscription(transactionId);
      await refreshSubscription();
      onSubscribed?.();
      Alert.alert('Restored', 'Your subscription has been restored.');
    } catch (err) {
      Alert.alert('Restore failed', err.message || 'Could not restore purchases.');
    } finally {
      setRestoring(false);
    }
  };

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

        <TouchableOpacity
          style={[s.primaryBtn, (purchasing || restoring) && s.btnDisabled]}
          onPress={handleSubscribe}
          disabled={purchasing || restoring}
        >
          {purchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.primaryBtnText}>Subscribe monthly</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.restoreBtn}
          onPress={handleRestore}
          disabled={purchasing || restoring}
        >
          <Text style={s.restoreBtnText}>{restoring ? 'Restoring...' : 'Restore purchases'}</Text>
        </TouchableOpacity>
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
  primaryBtn: {
    backgroundColor: '#2D6A4F',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  restoreBtn: {
    padding: 12,
    alignItems: 'center',
  },
  restoreBtnText: {
    color: '#2D6A4F',
    fontSize: 15,
    fontWeight: '600',
  },
});
