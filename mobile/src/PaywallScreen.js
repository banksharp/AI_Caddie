import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SUBSCRIPTION_PRODUCT_IDS,
  SUBSCRIPTION_PRODUCT_ID_MONTHLY,
  SUBSCRIPTION_PRODUCT_ID_YEARLY,
} from './constants';
import * as api from './api';
import { useSubscription } from './SubscriptionContext';
import { useAuth } from './AuthContext';

let iap = null;
try {
  iap = require('expo-iap');
} catch {
  iap = null;
}

/** True when StoreKit already has this subscription (e.g. canceled but still in paid period, or DB out of sync). */
function isAlreadyOwnedError(err) {
  const m = (err?.message || String(err || '')).toLowerCase();
  const code = err?.code;
  return (
    m.includes('already owned') ||
    m.includes('already purchased') ||
    m.includes('item already owned') ||
    m.includes('already subscribed') ||
    code === 'E_ALREADY_OWNED' ||
    code === 'E_ITEM_ALREADY_OWNED'
  );
}

/**
 * Picks the subscription purchase that is still entitled (latest expiry), or null if none is.
 * StoreKit also returns old renewals and lapsed subscriptions; sending one of those to the
 * server only produces "Subscription already expired".
 */
function pickActiveSubscription(purchases) {
  const subs = (Array.isArray(purchases) ? purchases : [])
    .filter((p) => SUBSCRIPTION_PRODUCT_IDS.includes(p.productId));
  if (subs.length === 0) return null;

  subs.sort((a, b) =>
    ((b.expirationDateIOS ?? 0) - (a.expirationDateIOS ?? 0)) ||
    ((b.transactionDate ?? 0) - (a.transactionDate ?? 0)));
  const latest = subs[0];

  if (Platform.OS === 'ios' && latest.expirationDateIOS && latest.expirationDateIOS <= Date.now()) {
    return null;
  }
  return latest;
}

/** Used by Restore and by Subscribe only after Apple returns “already owned”. Not run before purchase — that skipped the sheet. */
async function getTransactionIdForCurrentSubscription() {
  if (!iap) return null;
  await iap.initConnection();
  await iap.restorePurchases();

  // Include items that are still entitled until period end (e.g. canceled but not expired).
  const purchases = await iap.getAvailablePurchases({
    alsoPublishToEventListenerIOS: false,
    onlyIncludeActiveItemsIOS: false,
  });

  const sub = pickActiveSubscription(purchases);

  if (!sub) return null;
  return Platform.OS === 'ios'
    ? (sub.transactionId ?? null)
    : (sub.purchaseToken ?? sub.transactionId ?? null);
}

const PERIOD_FALLBACK = {
  [SUBSCRIPTION_PRODUCT_ID_MONTHLY]: 'month',
  [SUBSCRIPTION_PRODUCT_ID_YEARLY]: 'year',
};

/** "month", "year", "3 months", ... from the store's period, falling back to the product ID. */
function periodLabel(product, productId) {
  const unit = product?.subscriptionPeriodUnitIOS;
  const count = Number(product?.subscriptionPeriodNumberIOS) || 1;
  if (unit && unit !== 'empty') return count > 1 ? `${count} ${unit}s` : unit;
  return PERIOD_FALLBACK[productId] ?? 'period';
}

/** Small, secondary line describing an introductory offer, or null when there isn't one. */
function introOfferText(product) {
  const mode = product?.introductoryPricePaymentModeIOS;
  if (!mode || mode === 'empty') return null;
  const count = Number(product.introductoryPriceNumberOfPeriodsIOS) || 1;
  const unit = product.introductoryPriceSubscriptionPeriodIOS;
  const length = unit && unit !== 'empty' ? `${count} ${unit}${count > 1 ? 's' : ''}` : null;
  if (mode === 'free-trial') {
    return length ? `Includes a ${length} free trial for eligible new subscribers.` : 'Includes a free trial for eligible new subscribers.';
  }
  if (product.introductoryPriceIOS) {
    return `Introductory price of ${product.introductoryPriceIOS}${length ? ` for ${length}` : ''} for eligible new subscribers.`;
  }
  return null;
}

/** Loads the subscription products from the store, keyed by product ID. */
async function loadProducts() {
  if (!iap) throw new Error('In-app purchases not available in this build.');
  await iap.initConnection();
  const products = await iap.fetchProducts({
    skus: SUBSCRIPTION_PRODUCT_IDS,
    type: 'subs',
  });
  const byId = {};
  for (const p of products ?? []) byId[p.id ?? p.productId] = p;
  return byId;
}

async function connectAndPurchase(productId, userId) {
  if (!iap) throw new Error('In-app purchases not available in this build.');
  if (!productId) throw new Error('Missing subscription product.');
  if (!userId) throw new Error('You must be signed in to subscribe.');

  await iap.initConnection();

  const products = await iap.fetchProducts({
    skus: SUBSCRIPTION_PRODUCT_IDS,
    type: 'subs',
  });

  if (!products || products.length === 0) {
    throw new Error(
      'Subscription products not found in the store. ' +
      'Please verify the product ID matches App Store Connect and that the ' +
      'subscription has a price, localization, and status "Ready to Submit".',
    );
  }

  // Subscribe: always show Apple’s purchase flow first. (Restore uses getTransactionIdForCurrentSubscription only.)
  let result;
  try {
    result = await iap.requestPurchase({
      request: {
        // appAccountToken binds the Apple transaction to this account; the server rejects mismatches.
        apple: { sku: productId, appAccountToken: userId },
        google: { skus: [productId] },
      },
      type: 'subs',
    });
  } catch (err) {
    // Same entitlement on device but purchase sheet can’t run again — verify with StoreKit (differs from Restore: only after this error).
    if (isAlreadyOwnedError(err)) {
      const tid = await getTransactionIdForCurrentSubscription();
      if (tid) return tid;
    }
    throw err;
  }

  const purchase = Array.isArray(result) ? result[0] : result;
  if (!purchase) throw new Error('Purchase was cancelled.');

  const transactionId = Platform.OS === 'ios'
    ? (purchase.transactionId ?? null)
    : (purchase.purchaseToken ?? purchase.transactionId ?? null);
  if (!transactionId) throw new Error('Could not get transaction ID.');

  try { await iap.finishTransaction({ purchase, isConsumable: false }); } catch {}
  return transactionId;
}

async function connectAndRestore() {
  if (!iap) throw new Error('In-app purchases not available in this build.');

  const transactionId = await getTransactionIdForCurrentSubscription();
  if (!transactionId) throw new Error('No active subscription found for this account.');

  return transactionId;
}

export function PaywallScreen({ onSubscribed, title, subtitle }) {
  const { refreshSubscription } = useSubscription();
  const { user } = useAuth();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [plan, setPlan] = useState('monthly'); // 'monthly' | 'yearly'
  const [products, setProducts] = useState(null); // { [productId]: product } once loaded
  const [productsError, setProductsError] = useState(null);

  const fetchPrices = useCallback(async () => {
    setProductsError(null);
    try {
      const byId = await loadProducts();
      if (Object.keys(byId).length === 0) throw new Error('No subscriptions found.');
      setProducts(byId);
    } catch (err) {
      setProductsError(err?.message || 'Could not load prices.');
    }
  }, []);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  const productIdFor = (p) =>
    p === 'yearly' ? SUBSCRIPTION_PRODUCT_ID_YEARLY : SUBSCRIPTION_PRODUCT_ID_MONTHLY;
  const selectedId = productIdFor(plan);
  const selected = products?.[selectedId];
  const price = selected?.displayPrice;
  const period = periodLabel(selected, selectedId);
  const intro = introOfferText(selected);
  const busy = purchasing || restoring;

  const handleSubscribe = async () => {
    setPurchasing(true);
    try {
      const transactionId = await connectAndPurchase(selectedId, user?.id);
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
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <Ionicons name="golf" size={48} color="#2D6A4F" />
        </View>
        <Text style={s.title}>{title ?? 'Unlock Club Sense Pro'}</Text>
        <Text style={s.subtitle}>
          {subtitle ?? 'Get club recommendations and course strategy on every hole. Subscribe to unlock.'}
        </Text>

        <View style={s.features}>
          <FeatureRow text="Club recommendation by distance, lie & wind" />
          <FeatureRow text="Hole-by-hole course strategy" />
          <FeatureRow text="Save and edit your club distances" />
        </View>

        <View style={s.planRow}>
          {['monthly', 'yearly'].map((p) => {
            const active = plan === p;
            const id = productIdFor(p);
            const planPrice = products?.[id]?.displayPrice;
            return (
              <TouchableOpacity
                key={p}
                style={[s.planBtn, active && s.planBtnActive]}
                onPress={() => setPlan(p)}
                disabled={busy}
              >
                <Text style={[s.planBtnText, active && s.planBtnTextActive]}>
                  {p === 'yearly' ? 'Yearly' : 'Monthly'}
                </Text>
                {planPrice ? (
                  <>
                    <Text style={[s.planBtnPrice, active && s.planBtnTextActive]}>{planPrice}</Text>
                    <Text style={[s.planBtnText, active && s.planBtnTextActive]}>
                      per {periodLabel(products[id], id)}
                    </Text>
                  </>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {intro ? <Text style={s.introText}>{intro}</Text> : null}
        {!products ? (
          <View style={s.priceStatus}>
            {productsError ? (
              <>
                <Text style={s.priceError}>Couldn't load subscription prices.</Text>
                <TouchableOpacity onPress={fetchPrices} disabled={busy}>
                  <Text style={s.retryText}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : (
              <ActivityIndicator color="#2D6A4F" />
            )}
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.primaryBtn, (busy || !price) && s.btnDisabled]}
          onPress={handleSubscribe}
          disabled={busy || !price}
        >
          {purchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.primaryBtnText}>
              {price ? `Subscribe for ${price}/${period}` : 'Subscribe'}
            </Text>
          )}
        </TouchableOpacity>

        {price ? (
          <Text style={s.disclosure}>
            {`${price} is charged to your Apple Account when you confirm the purchase. The subscription renews automatically at ${price} per ${period} unless it is canceled at least 24 hours before the end of the current period. Manage or cancel it in your App Store account settings.`}
          </Text>
        ) : null}

        <TouchableOpacity
          style={s.restoreBtn}
          onPress={handleRestore}
          disabled={busy}
        >
          <Text style={s.restoreBtnText}>{restoring ? 'Restoring...' : 'Restore purchases'}</Text>
        </TouchableOpacity>

        <View style={s.legalRow}>
          <TouchableOpacity onPress={() => Linking.openURL('https://banksharp.github.io/AI_Caddie/privacy.html')}>
            <Text style={s.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={s.legalSeparator}>•</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://banksharp.github.io/AI_Caddie/terms.html')}>
            <Text style={s.legalLink}>Terms of Use</Text>
          </TouchableOpacity>
          <Text style={s.legalSeparator}>•</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://banksharp.github.io/AI_Caddie/support.html')}>
            <Text style={s.legalLink}>Support</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
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
  },
  content: {
    flexGrow: 1,
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
  planRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  planBtn: {
    flex: 1,
    backgroundColor: '#F0F7F4',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDEAE4',
  },
  planBtnActive: {
    backgroundColor: '#2D6A4F',
    borderColor: '#2D6A4F',
  },
  planBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D6A4F',
  },
  planBtnTextActive: {
    color: '#fff',
  },
  planBtnPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2D6A4F',
    marginTop: 2,
  },
  priceStatus: {
    alignItems: 'center',
    marginBottom: 14,
  },
  introText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 12,
  },
  priceError: {
    fontSize: 14,
    color: '#B91C1C',
    textAlign: 'center',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D6A4F',
    marginTop: 6,
  },
  disclosure: {
    fontSize: 11,
    lineHeight: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 4,
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
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  legalLink: {
    fontSize: 12,
    color: '#6B7280',
    textDecorationLine: 'underline',
    marginHorizontal: 4,
  },
  legalSeparator: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
