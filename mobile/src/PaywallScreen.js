import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIAP, getAvailablePurchases } from 'expo-iap';
import { SUBSCRIPTION_PRODUCT_ID } from './constants';
import * as api from './api';
import { useSubscription } from './SubscriptionContext';

export function PaywallScreen({ onSubscribed, title, subtitle }) {
  const { refreshSubscription } = useSubscription();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handlePurchaseSuccess = useCallback(
    async (purchase) => {
      const transactionId = purchase.transactionId ?? purchase.transactionIdIOS ?? null;
      if (!transactionId) {
        Alert.alert('Error', 'Could not get transaction ID. Please try Restore.');
        return;
        // Android: backend may need purchaseToken; we only verify Apple for now.
      }
      try {
        await api.verifySubscription(transactionId);
        await refreshSubscription();
        onSubscribed?.();
      } catch (err) {
        Alert.alert('Error', err.message || 'Verification failed');
      }
    },
    [refreshSubscription, onSubscribed]
  );

  const { connected, subscriptions, fetchProducts, requestPurchase, restorePurchases } = useIAP({
    onPurchaseSuccess: handlePurchaseSuccess,
    onPurchaseError: (err) => {
      setPurchasing(false);
      const msg = err?.message || 'Purchase failed';
      if (msg.toLowerCase().includes('cancel')) return;
      Alert.alert('Purchase failed', msg);
    },
    onError: (err) => {
      setPurchasing(false);
      setRestoring(false);
      Alert.alert('Error', err.message || 'Something went wrong');
    },
  });

  const subscriptionProduct = subscriptions?.find((s) => s.id === SUBSCRIPTION_PRODUCT_ID);
  const price = subscriptionProduct?.localizedPrice ?? subscriptionProduct?.price ?? null;

  const handleSubscribe = async () => {
    if (!connected) {
      Alert.alert(
        'Not available',
        'In-app purchases require a development build (not Expo Go). Build the app and try again.'
      );
      return;
    }
    setPurchasing(true);
    try {
      await fetchProducts({ skus: [SUBSCRIPTION_PRODUCT_ID], type: 'subs' });
      await requestPurchase({
        request: { apple: { sku: SUBSCRIPTION_PRODUCT_ID }, google: { skus: [SUBSCRIPTION_PRODUCT_ID] } },
        type: 'subs',
      });
      setPurchasing(false);
    } catch (err) {
      setPurchasing(false);
      Alert.alert('Error', err.message || 'Purchase failed');
    }
  };

  const handleRestore = async () => {
    if (!connected) {
      Alert.alert(
        'Not available',
        'Restore requires a development build (not Expo Go).'
      );
      return;
    }
    setRestoring(true);
    try {
      await restorePurchases();
      const purchases = await getAvailablePurchases({
        alsoPublishToEventListenerIOS: false,
        onlyIncludeActiveItemsIOS: true,
      });
      const subscriptionPurchase = Array.isArray(purchases)
        ? purchases.find((p) => p.productId === SUBSCRIPTION_PRODUCT_ID)
        : null;
      const tid = subscriptionPurchase?.transactionId ?? subscriptionPurchase?.transactionIdIOS ?? subscriptionPurchase?.purchaseToken;
      if (tid) {
        await api.verifySubscription(tid);
        await refreshSubscription();
        onSubscribed?.();
        Alert.alert('Restored', 'Your subscription has been restored.');
      } else {
        Alert.alert('No subscription found', 'We couldn’t find an active subscription for this account.');
      }
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
            <>
              <Text style={s.primaryBtnText}>
                {price ? `Subscribe — ${price}/month` : 'Subscribe monthly'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.restoreBtn}
          onPress={handleRestore}
          disabled={purchasing || restoring}
        >
          <Text style={s.restoreBtnText}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
        </TouchableOpacity>

        {!connected && (
          <Text style={s.devNote}>
            In-app purchases require a development build (not Expo Go). Run the app with a dev build to subscribe.
          </Text>
        )}
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
  devNote: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
});
