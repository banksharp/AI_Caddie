import { Slot } from 'expo-router';
import { AuthProvider } from '../src/AuthContext';
import { SubscriptionProvider } from '../src/SubscriptionContext';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <AuthProvider>
      <SubscriptionProvider>
        <StatusBar style="light" />
        <Slot />
      </SubscriptionProvider>
    </AuthProvider>
  );
}
