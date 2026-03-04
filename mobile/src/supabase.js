import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// TODO: Replace with your Supabase project values
const SUPABASE_URL = 'https://gnfokeidwbmzgykmwluz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZm9rZWlkd2Jtemd5a213bHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTAwNzEsImV4cCI6MjA4ODIyNjA3MX0.xX2jHlEYbjs1V62gm8F9ftFeiu3N3pDiqjqxKbh4Y9M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
