import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseClientConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseClientConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export interface HealthStatus {
  ok: boolean;
  supabaseClientConfigured: boolean;
  supabaseServerConfigured: boolean;
  moolreConfigured: boolean;
  sasusyncConfigured: boolean;
}

export async function fetchServerHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('Health check failed');
    return await res.json();
  } catch {
    return {
      ok: false,
      supabaseClientConfigured: isSupabaseClientConfigured,
      supabaseServerConfigured: false,
      moolreConfigured: false,
      sasusyncConfigured: false,
    };
  }
}
