import { createContext, useContext, useState, useEffect } from 'react';
import { Linking } from 'react-native';
import { supabase } from './supabase';

const AuthContext = createContext(null);

function extractAuthCode(url) {
  if (!url) return null;
  try {
    const codeMatch = url.match(/[?&#]code=([^&#]+)/);
    return codeMatch ? codeMatch[1] : null;
  } catch {
    return null;
  }
}

function extractAuthError(url) {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(url);
    const errorCodeMatch = decoded.match(/[?&#]error_code=([^&#]+)/);
    const errorDescriptionMatch = decoded.match(/[?&#]error_description=([^&#]+)/);
    if (!errorCodeMatch && !errorDescriptionMatch) return null;
    return {
      code: errorCodeMatch ? errorCodeMatch[1] : 'unknown_error',
      description: errorDescriptionMatch
        ? errorDescriptionMatch[1].replace(/\+/g, ' ')
        : 'Verification link is invalid or expired.',
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLinkError, setAuthLinkError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function handleDeepLink(url) {
      const code = extractAuthCode(url);
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        setAuthLinkError(null);
        return;
      }
      const linkError = extractAuthError(url);
      if (linkError) setAuthLinkError(linkError);
    }

    Linking.getInitialURL().then(handleDeepLink);
    const sub = Linking.addEventListener('url', (event) => handleDeepLink(event.url));
    return () => sub.remove();
  }, []);

  async function signUp(firstName, lastName, email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
        emailRedirectTo: 'ai-caddie://auth/callback',
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signUp,
        signIn,
        signOut,
        authLinkError,
        clearAuthLinkError: () => setAuthLinkError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
