import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_MEMORY_OS_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_MEMORY_OS_SUPABASE_ANON_KEY as
  | string
  | undefined;

let cached: SupabaseClient | null | undefined;

export function createBrowserSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  if (!url || !anonKey) {
    cached = null;
    return cached;
  }
  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}

export type { Session };
