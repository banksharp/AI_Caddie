import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import * as api from './api';

const SubscriptionContext = createContext(null);

export function SubscriptionProvider({ children }) {
  const { token } = useAuth();
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSubscription = useCallback(async () => {
    if (!token) {
      setSubscriptionActive(false);
      setSubscriptionExpiresAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.getProfile();
      setSubscriptionActive(data.subscription_active ?? false);
      setSubscriptionExpiresAt(data.subscription_expires_at ?? null);
    } catch {
      setSubscriptionActive(false);
      setSubscriptionExpiresAt(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  return (
    <SubscriptionContext.Provider
      value={{
        subscriptionActive,
        subscriptionExpiresAt,
        loading,
        refreshSubscription,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside SubscriptionProvider');
  return ctx;
}
