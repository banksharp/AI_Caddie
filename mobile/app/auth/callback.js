import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/AuthContext';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { user, loading, authLinkError } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (user?.email_confirmed_at) {
      router.replace('/(tabs)');
      return;
    }

    router.replace({
      pathname: '/verify-email',
      params: {
        email: user?.email ?? '',
        reason: authLinkError?.code ?? '',
      },
    });
  }, [loading, user, authLinkError, router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2D6A4F' }}>
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}
