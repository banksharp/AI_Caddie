import { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setToken, clearToken } from './api';

const AuthContext = createContext(null);

const TOKEN_KEY = 'ai_caddie_token';

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY).then((saved) => {
      if (saved) {
        setTokenState(saved);
        setToken(saved);
      }
      setLoading(false);
    });
  }, []);

  async function signIn(accessToken) {
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
    setTokenState(accessToken);
    setToken(accessToken);
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setTokenState(null);
    clearToken();
  }

  return (
    <AuthContext.Provider value={{ token, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
