import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

// Створюємо ліниво: без VITE_SUPABASE_URL (тести, перший запуск) застосунок не падає на старті.
// Сесію кладе сюди auth-стор (setSession), далі supabase-js сам зберігає й оновлює її.
export function supabase(): SupabaseClient {
  client ??= createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { storageKey: 'cabinet.auth', detectSessionInUrl: false },
  })
  return client
}
