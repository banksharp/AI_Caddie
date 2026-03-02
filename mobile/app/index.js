import { Redirect } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2D6A4F' }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (token) return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
